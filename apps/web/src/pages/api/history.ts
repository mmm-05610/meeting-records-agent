/**
 * POST /api/history —— { thread_id } → Agent `POST /meeting-assistant/history`。
 *
 * 返回 { messages, answer_records, scope, run_status }；
 * 线程归属在服务端核对，调用方不能指定他人线程。
 */

import type { NextApiRequest, NextApiResponse } from 'next';

import {
  agentFetchJson,
  agentHistoryUrl,
  agentThreadsUrl,
} from '@/server/agent';
import { requireSession } from '@/server/auth';
import {
  allowMethods,
  inputError,
  scopeForbidden,
  withApiErrors,
} from '@/server/errors';
import { readJsonBody } from '@/server/multipart';

interface AgentMessage {
  id?: string;
  role?: string;
  content?: unknown;
}

export const config = {
  api: { bodyParser: false },
};

export default withApiErrors(
  async (req: NextApiRequest, res: NextApiResponse) => {
    if (!allowMethods(req, res, ['POST'])) {
      return;
    }
    const session = requireSession(req);

    const body = await readJsonBody(req);
    const threadId =
      typeof body.thread_id === 'string' ? body.thread_id.trim() : '';
    if (!threadId) {
      throw inputError('缺少 thread_id。', ['thread_id']);
    }

    const payload = await agentFetchJson(agentHistoryUrl(), {
      method: 'POST',
      body: JSON.stringify({ thread_id: threadId }),
    });

    const result = (payload ?? {}) as {
      messages?: AgentMessage[];
      answer_records?: unknown[];
      scope?: unknown;
      run_status?: string;
    };
    const messages = Array.isArray(result.messages) ? result.messages : [];
    const answerRecords = Array.isArray(result.answer_records)
      ? result.answer_records
      : [];

    // A brand-new thread has no persisted messages and needs no ownership check.
    // Existing threads are only readable by the account that owns them.
    if (messages.length > 0 || answerRecords.length > 0) {
      await assertThreadOwnership(session.uid, threadId);
    }

    return res.status(200).json({
      messages: messages.map((message) => ({
        id: message.id ?? '',
        role: message.role ?? 'assistant',
        content: message.content ?? '',
      })),
      answer_records: answerRecords,
      scope: result.scope ?? null,
      run_status:
        typeof result.run_status === 'string'
          ? result.run_status
          : messages.length > 0
            ? 'completed'
            : 'empty',
    });
  }
);

/**
 * 核对线程归属：Agent 的 /history 只按 thread_id 读取，
 * 因此先用 /threads（服务端注入 user_id）确认该线程属于当前账号。
 * 线程列表为空（服务未配置 checkpointer）时无法核对，放行并在日志中记录。
 */
async function assertThreadOwnership(
  userId: string,
  threadId: string
): Promise<void> {
  const payload = await agentFetchJson(agentThreadsUrl(userId, 100));
  const body = (payload ?? {}) as { threads?: Array<{ thread_id?: string }> };
  const threads = Array.isArray(body.threads) ? body.threads : [];
  if (threads.length === 0) {
    console.warn(
      '[web-api] 线程列表为空，跳过归属核对（Agent 未配置 checkpointer）'
    );
    return;
  }
  const owned = threads.some((thread) => thread.thread_id === threadId);
  if (!owned) {
    throw scopeForbidden('线程不存在或不属于当前账号。', 404, ['thread_id']);
  }
}
