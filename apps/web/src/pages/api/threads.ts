/**
 * GET /api/threads —— 当前账号的线程列表（Agent `GET /meeting-assistant/threads`）。
 *
 * user_id 由服务端注入，调用方无法指定他人账号。
 */

import type { NextApiRequest, NextApiResponse } from 'next';

import { agentFetchJson, agentThreadsUrl } from '@/server/agent';
import { requireSession } from '@/server/auth';
import { allowMethods, inputError, withApiErrors } from '@/server/errors';

interface AgentThread {
  thread_id?: string;
  title?: string | null;
  updated_at?: string | null;
}

export default withApiErrors(
  async (req: NextApiRequest, res: NextApiResponse) => {
    if (!allowMethods(req, res, ['GET'])) {
      return;
    }
    const session = requireSession(req);

    const rawLimit = Array.isArray(req.query.limit)
      ? req.query.limit[0]
      : req.query.limit;
    const limit = Number.parseInt(rawLimit ?? '20', 10);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw inputError('线程数量不合法。', ['limit']);
    }

    const payload = await agentFetchJson(agentThreadsUrl(session.uid, limit));
    const body = (payload ?? {}) as { threads?: AgentThread[] };
    const threads = Array.isArray(body.threads) ? body.threads : [];

    return res.status(200).json({
      threads: threads.map((thread) => ({
        thread_id: thread.thread_id ?? '',
        title: thread.title ?? thread.thread_id ?? '',
        updated_at: thread.updated_at ?? null,
      })),
    });
  }
);
