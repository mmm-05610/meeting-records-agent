/**
 * Regression tests for chat history <-> AnswerRecord pairing.
 *
 * Run: apps/web/node_modules/.bin/tsx tests/e2e/history-pairing.test.ts
 *
 * The first fixture reimplements the released v0.1 algorithm (next-completed-record
 * fallback) and asserts it produces the reported defects; the rest verify 0.1.1.
 */

import assert from 'node:assert/strict';

import {
  looksLikeClarification,
  pairHistory,
  type HistoryMessageLike,
  type HistoryRecordLike,
} from '../../apps/web/src/lib/chat-history.ts';

interface TestRecord extends HistoryRecordLike {
  message_id?: string;
  text: string;
  status: 'completed' | 'failed' | 'interrupted';
}

const msg = (id: string, role: 'user' | 'assistant', content: string): HistoryMessageLike => ({
  id,
  role,
  content,
});

const rec = (message_id: string, text: string, status: TestRecord['status'] = 'completed'): TestRecord => ({
  message_id,
  text,
  status,
});

function legacyPair(messages: HistoryMessageLike[], records: TestRecord[]): (TestRecord | null)[] {
  // verbatim behaviour of apps/web/src/hooks/use-meeting-agent.ts before 0.1.1
  const recordsByMessage = new Map<string, TestRecord>();
  const pending = [...records];
  for (const record of records) {
    if (record.message_id) recordsByMessage.set(record.message_id, record);
  }
  return messages.map((message) => {
    if (message.role === 'user') return null;
    const byId = message.id ? recordsByMessage.get(message.id) : undefined;
    if (byId) {
      const index = pending.indexOf(byId);
      if (index >= 0) pending.splice(index, 1);
      return byId;
    }
    const byText = pending.find((r) => r.text.trim() === message.content.trim());
    const byOrder = byText ?? pending.find((r) => r.status === 'completed') ?? pending[0];
    if (byOrder) {
      const index = pending.indexOf(byOrder);
      if (index >= 0) pending.splice(index, 1);
    }
    return byOrder ?? null;
  });
}

let failures = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}\n  ${(error as Error).message.split('\n').join('\n  ')}`);
  }
}

// ---------------------------------------------------------------- reproduction
check('released v0.1 pairing mis-assigns a later success to an earlier failed turn', () => {
  const messages = [
    msg('u1', 'user', '问题一'),
    msg('m1', 'assistant', '答案一'),
    msg('u2', 'user', '问题二（当时失败）'),
    msg('m2', 'assistant', '服务暂时不可用，请重试'),
    msg('u3', 'user', '问题三'),
    msg('m3', 'assistant', '答案三'),
  ];
  const records = [rec('m1', '答案一'), rec('m3', '答案三')];
  const legacy = legacyPair(messages, records);
  // Returns m3's record for the failed turn, and again for the real m3 message.
  assert.equal(legacy[3]?.message_id, 'm3');
  assert.equal(legacy[5]?.message_id, 'm3');
  assert.equal(new Set(legacy.filter(Boolean)).size, 2);
  const fixed = pairHistory(messages, records).turns;
  assert.equal(fixed[1].record?.message_id, 'm1');
  assert.equal(fixed[3].record, null, 'failed turn must not borrow another answer');
  assert.equal(fixed[5].record?.message_id, 'm3');
});

// ---------------------------------------------------------------- new behaviour
check('pairs by message id and keeps failure/clarification states', () => {
  const messages = [
    msg('u1', 'user', '问题一'),
    msg('m1', 'assistant', '答案一'),
    msg('u2', 'user', '问题二'),
    msg('m2', 'assistant', '服务暂时不可用，请重试'),
    msg('u3', 'user', '问题三'),
    msg('m3', 'assistant', '你想了解哪一场会议？'),
    msg('u4', 'user', '问题四'),
    msg('m4', 'assistant', '答案四'),
  ];
  const records = [rec('m1', '答案一'), rec('m4', '答案四')];
  const result = pairHistory(messages, records);
  assert.deepEqual(
    result.turns.map((turn) => turn.record?.message_id ?? null),
    [null, 'm1', null, null, null, null, null, 'm4']
  );
  assert.equal(result.turns[3].clarification, false);
  assert.equal(result.turns[3].unresolvedAnswer, true);
  assert.equal(result.turns[5].clarification, true);
  assert.equal(result.turns[5].unresolvedAnswer, false);
  assert.equal(result.usedRecords.length, 2);
});

check('legacy data without ids pairs only on unique exact text', () => {
  const messages = [msg('a1', 'assistant', '唯一答案正文'), msg('a2', 'assistant', '另一段回答')];
  const records: TestRecord[] = [
    { text: '唯一答案正文', status: 'completed' },
    { text: '另一段回答', status: 'completed' },
  ];
  const result = pairHistory(messages, records);
  assert.ok(result.turns[0].record);
  assert.ok(result.turns[1].record);
  assert.equal(result.unmatchedRecords.length, 0);
});

check('ambiguous duplicate text on either side is never guessed', () => {
  const duplicateMessages = [msg('a1', 'assistant', '重复正文'), msg('a2', 'assistant', '重复正文')];
  const oneRecord: TestRecord[] = [{ text: '重复正文', status: 'completed' }];
  // identical texts are indistinguishable; the single record is authoritative
  // and the extra identical message is a legacy duplicate, not a second answer.
  const first = pairHistory(duplicateMessages, oneRecord);
  assert.equal(first.turns.length, 1);
  assert.equal(first.turns[0].record?.text, '重复正文');
  assert.equal(first.unmatchedRecords.length, 0);
  assert.equal(first.droppedDuplicateTurns, 1);

  const oneMessage = [msg('a1', 'assistant', '重复正文')];
  const duplicateRecords: TestRecord[] = [
    { text: '重复正文', status: 'completed' },
    { text: '重复正文', status: 'completed' },
  ];
  // two records with the same text stay ambiguous: never guess, never reuse.
  const second = pairHistory(oneMessage, duplicateRecords);
  assert.equal(second.turns[0].record, null);
  assert.equal(second.usedRecords.length, 0);
  assert.equal(second.unmatchedRecords.length, 2);
  assert.equal(second.droppedDuplicateTurns, 0);
});

check('one record is never assigned to two messages even with a repeated message id', () => {
  const messages = [msg('dup', 'assistant', '答案正文'), msg('dup', 'assistant', '答案正文')];
  const records = [rec('dup', '答案正文')];
  const result = pairHistory(messages, records);
  assert.equal(result.usedRecords.length, 1);
  assert.equal(result.turns.length, 1, 'duplicate artefact message is dropped');
  assert.equal(result.turns[0].record?.message_id, 'dup');
  assert.equal(result.droppedDuplicateTurns, 1);
});

check('whitespace-only text differences still pair uniquely', () => {
  const messages = [msg('a1', 'assistant', '答案  正文\n第二行')];
  const records: TestRecord[] = [{ text: '答案 正文 第二行', status: 'completed' }];
  const result = pairHistory(messages, records);
  assert.ok(result.turns[0].record);
});

check('user messages never receive records and keep their own content', () => {
  const messages = [msg('u1', 'user', '问题'), msg('m1', 'assistant', '答案')];
  const result = pairHistory(messages, [rec('m1', '答案')]);
  assert.equal(result.turns[0].record, null);
  assert.equal(result.turns[0].role, 'user');
  assert.equal(result.turns[0].content, '问题');
});

check('legacy duplicated answer message is dropped, not shown twice', () => {
  const messages = [
    msg('u1', 'user', '问题一'),
    msg('m1', 'assistant', '答案一'),
    msg('x1', 'assistant', '答案一'),
    msg('u2', 'user', '问题二'),
    msg('m2', 'assistant', '答案二'),
  ];
  const records = [rec('m1', '答案一'), rec('m2', '答案二')];
  const result = pairHistory(messages, records);
  assert.equal(result.droppedDuplicateTurns, 1);
  assert.deepEqual(
    result.turns.map((turn) => turn.content),
    ['问题一', '答案一', '问题二', '答案二']
  );
  assert.equal(result.usedRecords.length, 2);
});

check('clarification detection only applies to short question-like text', () => {
  assert.equal(looksLikeClarification('你想了解哪一场会议？'), true);
  assert.equal(looksLikeClarification('这是一个很长很长的最终答案，里面有完整的结论与来源引用 [1]，不应该被当作澄清。'), false);
  assert.equal(looksLikeClarification('你好'), false);
});

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log('\nALL_HISTORY_PAIRING_TESTS_PASSED');
