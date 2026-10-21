/**
 * 服务端 Agent 客户端（T012）。
 *
 * 浏览器只能通过同源 `/api/*` 访问 Agent；user_id 永远由服务端注入。
 */

import { agentApiUrl, UPSTREAM_TIMEOUT_MS } from './config';
import { ApiError } from './errors';

export const AGENT_ID = 'meeting-assistant';

export function agentRunUrl(): string {
  return `${agentApiUrl()}/agui/${AGENT_ID}/run`;
}

export function agentThreadsUrl(userId: string, limit: number): string {
  const query = new URLSearchParams({ user_id: userId, limit: String(limit) });
  return `${agentApiUrl()}/${AGENT_ID}/threads?${query.toString()}`;
}

export function agentHistoryUrl(): string {
  return `${agentApiUrl()}/${AGENT_ID}/history`;
}

/** Agent 错误响应 → C08 分类。 */
export function mapAgentStatus(status: number, payload: unknown): ApiError {
  const envelope = payload as { detail?: unknown; message?: unknown } | null;
  const detail =
    typeof envelope?.detail === 'string'
      ? envelope.detail
      : typeof envelope?.message === 'string'
        ? envelope.message
        : '';

  if (status === 400 || status === 422) {
    return new ApiError(
      status,
      'input_error',
      detail || '请求参数不合法。',
      [],
      false
    );
  }
  if (status === 401 || status === 403) {
    return new ApiError(
      status,
      'scope_forbidden',
      detail || '无权访问该资源。',
      [],
      false
    );
  }
  if (status === 404) {
    return new ApiError(
      status,
      'scope_forbidden',
      detail || '对象不存在或无权访问。',
      [],
      false
    );
  }
  if (status === 409) {
    return new ApiError(
      status,
      'duplicate_processing',
      detail || '对象已存在。',
      [],
      false
    );
  }
  if (status === 413 || status === 415) {
    return new ApiError(
      status,
      'input_error',
      detail || '请求内容不被接受。',
      [],
      false
    );
  }
  if (status === 429) {
    return new ApiError(
      status,
      'service_failure',
      detail || '服务繁忙，请稍后重试。',
      [],
      true
    );
  }
  if (status === 504 || status === 408) {
    return new ApiError(
      status,
      'unknown_result',
      detail || '服务响应超时，结果未知。',
      [],
      true
    );
  }
  if (status >= 500) {
    return new ApiError(
      status,
      'service_failure',
      detail || '服务处理失败，请稍后重试。',
      [],
      true
    );
  }
  return new ApiError(
    status,
    'service_failure',
    detail || '服务处理失败，请稍后重试。',
    [],
    false
  );
}

export async function agentFetchJson(
  url: string,
  init: { method?: string; body?: string; timeoutMs?: number } = {}
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    init.timeoutMs ?? UPSTREAM_TIMEOUT_MS
  );
  let response: Response;
  try {
    response = await fetch(url, {
      method: init.method ?? 'GET',
      body: init.body,
      headers: {
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
      signal: controller.signal,
      cache: 'no-store',
    });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === 'TimeoutError' || error.name === 'AbortError')
    ) {
      throw new ApiError(
        504,
        'unknown_result',
        '服务响应超时，结果未知。',
        [],
        true
      );
    }
    throw new ApiError(
      502,
      'service_failure',
      '无法连接 Agent 服务。',
      [],
      true
    );
  } finally {
    clearTimeout(timeout);
  }

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }
  if (!response.ok) {
    throw mapAgentStatus(response.status, payload);
  }
  return payload;
}
