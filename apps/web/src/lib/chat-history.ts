/**
 * Deterministic pairing of persisted chat messages with AnswerRecords.
 *
 * History can contain records written before messages carried a stable id, and it
 * can contain duplicate answer texts. Pairing therefore runs in two strict passes
 * and never guesses:
 *
 *   1. by message id (the authoritative link written by the meeting agent);
 *   2. by exact text, only when both sides have exactly one unconsumed candidate.
 *
 * Anything left unmatched keeps its own content and real state. A record is never
 * handed to two messages, and a later successful answer is never pulled into an
 * earlier failed/interrupted turn.
 */

export type HistoryRole = 'user' | 'assistant';

export interface HistoryMessageLike {
  id: string;
  role: HistoryRole | string;
  content: string;
}

export interface HistoryRecordLike {
  message_id?: string;
  text?: string;
  status?: string;
}

export interface PairedTurn<TRecord extends HistoryRecordLike> {
  id: string;
  role: HistoryRole;
  content: string;
  record: TRecord | null;
  /** True when the assistant only asked for clarification (no AnswerRecord). */
  clarification: boolean;
  /** True when this turn could not be matched to a record but still looks like an answer draft. */
  unresolvedAnswer: boolean;
}

export interface PairingResult<TRecord extends HistoryRecordLike> {
  turns: PairedTurn<TRecord>[];
  /** Records that were used, in message order (for invariant checks). */
  usedRecords: TRecord[];
  /** Records that could not be paired reliably. */
  unmatchedRecords: TRecord[];
  /**
   * Legacy artefacts: assistant messages whose text exactly duplicates a paired
   * AnswerRecord. Older builds could persist the same final answer twice; the
   * record is authoritative and the duplicate message is dropped from the view.
   */
  droppedDuplicateTurns: number;
}

const CLARIFICATION_PREFIX =
  /^(你想了解|请确认|请指明|请明确|请提供|请选择|哪一场|哪个方案|需要澄清)/;

export function looksLikeClarification(text: string): boolean {
  const value = text.trim();
  if (!value || value.length > 160) {
    return false;
  }
  if (CLARIFICATION_PREFIX.test(value)) {
    return true;
  }
  // A short question without citation markers is a clarification request; real
  // answers always carry citations once they pass validation.
  return (
    (value.endsWith('？') || value.endsWith('?')) && !/\[\d+\]/.test(value)
  );
}

function normalizeText(value: string | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, ' ');
}

function roleOf(message: HistoryMessageLike): HistoryRole {
  const raw = String(message.role ?? '').toLowerCase();
  if (raw === 'human' || raw === 'user') {
    return 'user';
  }
  return 'assistant';
}

export function pairHistory<TRecord extends HistoryRecordLike>(
  messages: HistoryMessageLike[],
  records: TRecord[],
  options: { makeId?: () => string } = {}
): PairingResult<TRecord> {
  const makeId =
    options.makeId ?? (() => `turn-${Math.random().toString(16).slice(2)}`);
  const used = new Set<TRecord>();
  const turnRecords: (TRecord | null)[] = messages.map(() => null);

  // Pass 1: authoritative message id.
  const byMessageId = new Map<string, TRecord[]>();
  for (const record of records) {
    const key =
      typeof record.message_id === 'string' ? record.message_id.trim() : '';
    if (!key) continue;
    const bucket = byMessageId.get(key) ?? [];
    bucket.push(record);
    byMessageId.set(key, bucket);
  }
  messages.forEach((message, index) => {
    if (roleOf(message) !== 'assistant') return;
    const messageId = message.id?.trim();
    if (!messageId) return;
    const bucket = byMessageId.get(messageId);
    if (!bucket) return;
    const record = bucket.find((candidate) => !used.has(candidate));
    if (!record) return;
    turnRecords[index] = record;
    used.add(record);
  });

  // Pass 2: exact-text pairing, only when unambiguous on both sides.
  const unmatchedRecordByText = new Map<string, TRecord[]>();
  for (const record of records) {
    if (used.has(record)) continue;
    const key = normalizeText(
      typeof record.text === 'string' ? record.text : ''
    );
    if (!key) continue;
    const bucket = unmatchedRecordByText.get(key) ?? [];
    bucket.push(record);
    unmatchedRecordByText.set(key, bucket);
  }
  const unmatchedAssistantByText = new Map<string, number[]>();
  messages.forEach((message, index) => {
    if (roleOf(message) !== 'assistant' || turnRecords[index]) return;
    const key = normalizeText(message.content);
    if (!key) return;
    const bucket = unmatchedAssistantByText.get(key) ?? [];
    bucket.push(index);
    unmatchedAssistantByText.set(key, bucket);
  });
  const duplicateMessageIndexes = new Set<number>();
  for (const [text, indices] of unmatchedAssistantByText) {
    const candidates = unmatchedRecordByText.get(text) ?? [];
    // Exactly one record for this text is authoritative; identical duplicate
    // messages are legacy double-writes of the same answer. Additional records
    // with the same text stay ambiguous and are never guessed.
    if (candidates.length !== 1 || indices.length === 0) {
      continue;
    }
    const record = candidates[0];
    if (used.has(record)) continue;
    const [first, ...rest] = indices;
    turnRecords[first] = record;
    used.add(record);
    for (const index of rest) duplicateMessageIndexes.add(index);
  }

  // Legacy duplicate artefacts: older builds could persist the same final answer
  // twice (one message with the AnswerRecord, one without). The record wins; an
  // unmatched message whose text exactly equals a paired record is dropped once.
  const usedTexts = new Set<string>();
  for (const record of records) {
    if (!used.has(record)) continue;
    const text = normalizeText(
      typeof record.text === 'string' ? record.text : ''
    );
    if (text) usedTexts.add(text);
  }

  let droppedDuplicateTurns = 0;
  const turns: PairedTurn<TRecord>[] = [];
  messages.forEach((message, index) => {
    if (duplicateMessageIndexes.has(index)) {
      droppedDuplicateTurns += 1;
      return;
    }
    const role = roleOf(message);
    const record = role === 'assistant' ? (turnRecords[index] ?? null) : null;
    const content =
      record && typeof record.text === 'string'
        ? record.text
        : (message.content ?? '');
    if (
      role === 'assistant' &&
      !record &&
      usedTexts.has(normalizeText(content))
    ) {
      droppedDuplicateTurns += 1;
      return;
    }
    const clarification =
      role === 'assistant' && !record && looksLikeClarification(content);
    turns.push({
      id: message.id?.trim() || makeId(),
      role,
      content,
      record,
      clarification,
      unresolvedAnswer: role === 'assistant' && !record && !clarification,
    });
  });

  return {
    turns,
    usedRecords: records.filter((record) => used.has(record)),
    unmatchedRecords: records.filter((record) => !used.has(record)),
    droppedDuplicateTurns,
  };
}
