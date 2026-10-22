/**
 * /api/copilotkit/* —— 同源 AG-UI 入口（C05）。
 *
 * 浏览器 → 本路由 → Agent `POST /agui/meeting-assistant/run`（SSE 透传）。
 *
 * - 身份只来自服务端会话，客户端提交的 user_id 一律拒绝；
 * - forwardedProps 只接受 meeting_scope 与 model，其余剥离并记录告警；
 * - 不透传 RAW 事件、内部提示或任何凭据。
 */

import { LangGraphHttpAgent } from '@copilotkit/runtime/langgraph';
import {
  CopilotRuntime,
  InMemoryAgentRunner,
  createCopilotRuntimeHandler,
} from '@copilotkit/runtime/v2';
import type { NextApiRequest, NextApiResponse } from 'next';

import { agentRunUrl, mapAgentStatus } from '@/server/agent';
import { requireSession } from '@/server/auth';
import { agentApiUrl } from '@/server/config';
import {
  allowMethods,
  ApiError,
  inputError,
  scopeForbidden,
  withApiErrors,
} from '@/server/errors';
import { validateScope } from '@/server/meeting';
import { readRawBody } from '@/server/multipart';

export const config = {
  api: { bodyParser: false },
};

const IDENTITY_KEYS = ['user_id'];
const STRIPPED_KEYS = ['configurable', 'sources', 'answer_record'];
const FORWARDED_WHITELIST = ['meeting_scope', 'model', 'strategy'];
const RUNTIME_BASE_PATH = '/api/copilotkit';
const STREAM_TIMEOUT_MS = Number(
  process.env.MRA_AGUI_TIMEOUT_MS || 15 * 60 * 1000
);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function pickKeys(source: Record<string, unknown>, keys: string[]): string[] {
  return keys.filter((key) =>
    Object.prototype.hasOwnProperty.call(source, key)
  );
}

function stripKeys(source: Record<string, unknown>, keys: string[]): void {
  for (const key of keys) {
    delete source[key];
  }
}

async function readBody(req: NextApiRequest): Promise<Record<string, unknown>> {
  const raw = await readRawBody(req);
  if (raw.length === 0) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString('utf8'));
  } catch {
    throw inputError('请求体不是合法 JSON。');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw inputError('请求体必须是 JSON 对象。');
  }
  return parsed as Record<string, unknown>;
}

export default withApiErrors(
  async (req: NextApiRequest, res: NextApiResponse) => {
    const session = requireSession(req);

    if (req.method === 'GET') {
      const slug = Array.isArray(req.query.slug)
        ? req.query.slug[0]
        : req.query.slug;
      if (slug === 'info' || slug === undefined) {
        return res.status(200).json({
          runtimeVersion: 'copilotkit-runtime-v2',
          langgraph: false,
          agents: {
            'meeting-assistant': {
              name: '会议记录助手',
              description: '基于本项目已入库的会议记录回答问题并给出引用。',
            },
          },
          endpoints: {
            runtime: `${RUNTIME_BASE_PATH}/agent/meeting-assistant/run`,
            upstreamAgent: `${agentApiUrl()}/agui/meeting-assistant/run`,
          },
        });
      }
      return res.status(404).json({
        error: {
          category: 'input_error',
          message: '接口不存在。',
          fields: [],
          retryable: false,
        },
      });
    }

    if (!allowMethods(req, res, ['POST'])) {
      return;
    }

    const body = await readBody(req);
    const forwardedRaw = asRecord(
      body.forwardedProps ?? body.forwarded_props ?? {}
    );
    const state = asRecord(body.state);

    // 1) 伪造身份 → 直接拒绝。
    const identityHits = [
      ...pickKeys(body, IDENTITY_KEYS),
      ...pickKeys(forwardedRaw, IDENTITY_KEYS),
      ...pickKeys(state, IDENTITY_KEYS),
    ];
    if (identityHits.length > 0) {
      console.warn(
        `[web-api] 拒绝携带身份字段的 AG-UI 请求: ${identityHits.join(',')}`
      );
      throw scopeForbidden('不允许提交身份字段。', 400, identityHits);
    }

    // 2) 其余禁止字段 → 剥离并告警。
    const stripped = [
      ...pickKeys(body, STRIPPED_KEYS),
      ...pickKeys(forwardedRaw, STRIPPED_KEYS),
      ...pickKeys(state, STRIPPED_KEYS),
    ];
    if (stripped.length > 0) {
      console.warn(
        `[web-api] 已剥离客户端提交的禁止字段: ${stripped.join(',')}`
      );
      stripKeys(body, STRIPPED_KEYS);
      stripKeys(forwardedRaw, STRIPPED_KEYS);
      stripKeys(state, STRIPPED_KEYS);
    }

    // 3) forwardedProps 白名单。
    const allowedForwarded: Record<string, unknown> = {};
    const droppedForwarded = Object.keys(forwardedRaw).filter(
      (key) => !FORWARDED_WHITELIST.includes(key)
    );
    if (droppedForwarded.length > 0) {
      console.warn(
        `[web-api] 已丢弃不在白名单内的 forwardedProps: ${droppedForwarded.join(',')}`
      );
    }
    if (forwardedRaw.meeting_scope !== undefined) {
      allowedForwarded.meeting_scope = validateScope(
        forwardedRaw.meeting_scope
      );
    } else {
      throw inputError('缺少会议范围。', ['meeting_scope']);
    }
    if (typeof forwardedRaw.model === 'string' && forwardedRaw.model.trim()) {
      allowedForwarded.model = forwardedRaw.model.trim();
    }
    if (
      typeof forwardedRaw.strategy === 'string' &&
      ['B0', 'B1', 'B2'].includes(forwardedRaw.strategy)
    ) {
      allowedForwarded.strategy = forwardedRaw.strategy;
    }

    const threadId = typeof body.threadId === 'string' ? body.threadId : '';
    if (!threadId.trim()) {
      throw inputError('缺少 threadId。', ['threadId']);
    }

    const upstreamBody = {
      threadId,
      runId: typeof body.runId === 'string' ? body.runId : '',
      messages: Array.isArray(body.messages) ? body.messages : [],
      tools: Array.isArray(body.tools) ? body.tools : [],
      context: Array.isArray(body.context) ? body.context : [],
      state,
      forwardedProps: allowedForwarded,
    };

    // Run through the official CopilotKit Runtime (v2): it validates the AG-UI
    // request, invokes the configured agent and streams AG-UI events back. The
    // runtime is built per request so the server-confirmed identity header is
    // bound to this authenticated session only.
    const runtime = new CopilotRuntime({
      agents: {
        'meeting-assistant': new LangGraphHttpAgent({
          url: agentRunUrl(),
          headers: { 'x-mra-user': session.uid },
        }),
      },
      runner: new InMemoryAgentRunner(),
    });
    const runtimeHandler = createCopilotRuntimeHandler({
      runtime,
      basePath: RUNTIME_BASE_PATH,
    });

    const runtimeRequest = new Request(
      `http://127.0.0.1${RUNTIME_BASE_PATH}/agent/meeting-assistant/run`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify(upstreamBody),
      }
    );

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), STREAM_TIMEOUT_MS);
    res.on('close', () => {
      if (!res.writableEnded) {
        controller.abort();
      }
    });

    let upstream: Response;
    try {
      upstream = await runtimeHandler(runtimeRequest);
    } catch (error) {
      clearTimeout(timeout);
      throw new ApiError(
        502,
        'service_failure',
        'CopilotKit Runtime 执行失败。',
        [],
        true
      );
    }

    if (!upstream.ok || !upstream.body) {
      clearTimeout(timeout);
      const text = await upstream.text();
      let payload: unknown = null;
      try {
        payload = text ? JSON.parse(text) : null;
      } catch {
        payload = null;
      }
      throw mapAgentStatus(upstream.status, payload);
    }

    const reader = upstream.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        if (value && value.length > 0) {
          res.write(Buffer.from(value));
        }
      }
    } catch (error) {
      console.error(
        '[web-api] AG-UI 流中断:',
        error instanceof Error ? error.message : 'unknown'
      );
    } finally {
      clearTimeout(timeout);
      if (!res.writableEnded) {
        res.end();
      }
    }
    return undefined;
  }
);
