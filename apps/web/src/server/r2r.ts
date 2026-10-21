/**
 * 服务端 R2R 客户端（T012）。
 *
 * 只在 Node 服务端运行；浏览器永远不直接访问 R2R。
 * 上游错误按 C08 映射为 ApiError。
 */

import { r2rApiUrl, UPSTREAM_TIMEOUT_MS } from './config';
import { ApiError } from './errors';

export interface R2rUser {
  id: string;
  email: string;
  is_superuser?: boolean;
}

export interface R2rCollection {
  id: string;
  name: string;
  description?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  document_count?: number;
}

export interface R2rDocument {
  id: string;
  collection_ids?: string[];
  owner_id?: string;
  document_type?: string;
  metadata?: Record<string, unknown> | null;
  title?: string | null;
  version?: string;
  size_in_bytes?: number;
  ingestion_status?: string | null;
  extraction_status?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface R2rChunk {
  id: string;
  document_id?: string;
  text?: string;
  metadata?: Record<string, unknown> | null;
  collection_ids?: string[];
}

interface R2rEnvelope<T> {
  results?: T;
  total_entries?: number;
  message?: string;
  detail?: string;
  error_type?: string;
}

function upstreamMessage(payload: unknown, fallback: string): string {
  const envelope = payload as R2rEnvelope<unknown> | null;
  const message = envelope?.message ?? envelope?.detail;
  if (typeof message === 'string' && message.trim()) {
    return message.trim();
  }
  return fallback;
}

/** R2R 状态码 → C08 分类。 */
export function mapR2rStatus(
  status: number,
  payload: unknown,
  context: string
): ApiError {
  const message = upstreamMessage(payload, `${context}失败。`);
  if (status === 400 || status === 413 || status === 415 || status === 422) {
    return new ApiError(status, 'input_error', message, [], false);
  }
  if (status === 401 || status === 403) {
    return new ApiError(status, 'scope_forbidden', message, [], false);
  }
  if (status === 404) {
    return new ApiError(
      status,
      'scope_forbidden',
      `${context}：对象不存在或无权访问。`,
      [],
      false
    );
  }
  if (status === 409) {
    return new ApiError(status, 'duplicate_processing', message, [], false);
  }
  if (status === 429) {
    return new ApiError(status, 'service_failure', message, [], true);
  }
  if (status >= 500) {
    return new ApiError(status, 'service_failure', message, [], true);
  }
  return new ApiError(status, 'service_failure', message, [], false);
}

function isTimeout(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'TimeoutError' || error.name === 'AbortError')
  );
}

async function r2rRequest<T>(
  token: string | null,
  path: string,
  init: {
    method?: string;
    body?: BodyInit;
    headers?: Record<string, string>;
    context: string;
    timeoutMs?: number;
  }
): Promise<T> {
  const { context } = init;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    init.timeoutMs ?? UPSTREAM_TIMEOUT_MS
  );
  let response: Response;
  try {
    response = await fetch(`${r2rApiUrl()}${path}`, {
      method: init.method ?? 'GET',
      body: init.body,
      headers: {
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init.headers ?? {}),
      },
      signal: controller.signal,
      cache: 'no-store',
    });
  } catch (error) {
    if (isTimeout(error)) {
      throw new ApiError(
        504,
        'unknown_result',
        `${context}超时，结果未知，请先查询当前状态再重试。`,
        [],
        true
      );
    }
    throw new ApiError(
      502,
      'service_failure',
      `${context}失败：无法连接检索服务。`,
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
    throw mapR2rStatus(response.status, payload, context);
  }
  return payload as T;
}

function envelopeResults<T>(payload: unknown): T {
  const envelope = payload as R2rEnvelope<T> | null;
  return (envelope?.results ?? payload) as T;
}

function envelopeTotal(payload: unknown): number {
  const envelope = payload as R2rEnvelope<unknown> | null;
  const total = envelope?.total_entries;
  return typeof total === 'number' ? total : 0;
}

/* ------------------------------------------------------------------ */
/* 认证                                                                */
/* ------------------------------------------------------------------ */

export interface R2rTokens {
  accessToken: string;
  refreshToken: string;
}

/** R2R `POST /v3/users/login`（OAuth2 表单编码）。 */
export async function r2rLogin(
  username: string,
  password: string
): Promise<R2rTokens> {
  const form = new URLSearchParams();
  form.set('username', username);
  form.set('password', password);
  const payload = await r2rRequest<unknown>(null, '/v3/users/login', {
    method: 'POST',
    body: form.toString(),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    context: '登录',
  });
  const results = envelopeResults<{
    access_token?: { token?: string };
    refresh_token?: { token?: string };
  }>(payload);
  const accessToken = results?.access_token?.token;
  if (!accessToken) {
    throw new ApiError(
      502,
      'service_failure',
      '登录失败：服务未返回访问令牌。',
      [],
      true
    );
  }
  return { accessToken, refreshToken: results?.refresh_token?.token ?? '' };
}

/** R2R `GET /v3/users/me`。 */
export async function r2rMe(token: string): Promise<R2rUser> {
  const payload = await r2rRequest<unknown>(token, '/v3/users/me', {
    context: '查询当前账号',
  });
  return envelopeResults<R2rUser>(payload);
}

/* ------------------------------------------------------------------ */
/* 集合（项目）                                                        */
/* ------------------------------------------------------------------ */

export async function r2rListCollections(
  token: string
): Promise<R2rCollection[]> {
  const payload = await r2rRequest<unknown>(
    token,
    '/v3/collections?limit=1000&offset=0',
    { context: '查询项目列表' }
  );
  const results = envelopeResults<R2rCollection[]>(payload);
  return Array.isArray(results) ? results : [];
}

export async function r2rGetCollection(
  token: string,
  collectionId: string
): Promise<R2rCollection> {
  const payload = await r2rRequest<unknown>(
    token,
    `/v3/collections/${encodeURIComponent(collectionId)}`,
    { context: '查询项目' }
  );
  return envelopeResults<R2rCollection>(payload);
}

export async function r2rCreateCollection(
  token: string,
  name: string,
  description?: string
): Promise<R2rCollection> {
  const payload = await r2rRequest<unknown>(token, '/v3/collections', {
    method: 'POST',
    body: JSON.stringify({ name, ...(description ? { description } : {}) }),
    headers: { 'Content-Type': 'application/json' },
    context: '创建项目',
  });
  return envelopeResults<R2rCollection>(payload);
}

/* ------------------------------------------------------------------ */
/* 文档（会议）                                                        */
/* ------------------------------------------------------------------ */

export async function r2rListCollectionDocuments(
  token: string,
  collectionId: string
): Promise<R2rDocument[]> {
  const payload = await r2rRequest<unknown>(
    token,
    `/v3/collections/${encodeURIComponent(collectionId)}/documents?limit=1000&offset=0`,
    { context: '查询会议列表' }
  );
  const results = envelopeResults<R2rDocument[]>(payload);
  return Array.isArray(results) ? results : [];
}

export async function r2rGetDocument(
  token: string,
  documentId: string
): Promise<R2rDocument | null> {
  try {
    const payload = await r2rRequest<unknown>(
      token,
      `/v3/documents/${encodeURIComponent(documentId)}`,
      { context: '查询会议' }
    );
    return envelopeResults<R2rDocument>(payload);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

export interface UploadDocumentInput {
  /** 确定性文档 ID（C01）。 */
  id: string;
  filename: string;
  contentType: string;
  bytes: Buffer;
  collectionId: string;
  /** 不含 title 的会议元数据（C01 适配）。 */
  metadata: Record<string, unknown>;
}

/** R2R `POST /v3/documents`（文件入口，run_with_orchestration=false）。 */
export async function r2rUploadDocument(
  token: string,
  input: UploadDocumentInput
): Promise<R2rDocument> {
  const form = new FormData();
  form.append(
    'file',
    new Blob([input.bytes], { type: input.contentType }),
    input.filename
  );
  form.append('id', input.id);
  form.append('collection_ids', JSON.stringify([input.collectionId]));
  form.append('metadata', JSON.stringify(input.metadata));
  form.append('run_with_orchestration', 'false');

  const payload = await r2rRequest<unknown>(token, '/v3/documents', {
    method: 'POST',
    body: form,
    context: '上传会议记录',
  });
  const results = envelopeResults<{ document_id?: string } & R2rDocument>(
    payload
  );
  return { ...results, id: results?.document_id ?? results?.id ?? input.id };
}

/** R2R `PATCH /v3/documents/{id}/metadata`（追加展示标题）。 */
export async function r2rAppendMetadata(
  token: string,
  documentId: string,
  entries: Array<Record<string, unknown>>
): Promise<void> {
  await r2rRequest<unknown>(
    token,
    `/v3/documents/${encodeURIComponent(documentId)}/metadata`,
    {
      method: 'PATCH',
      body: JSON.stringify(entries),
      headers: { 'Content-Type': 'application/json' },
      context: '写入会议元数据',
    }
  );
}

export async function r2rDeleteDocument(
  token: string,
  documentId: string
): Promise<void> {
  await r2rRequest<unknown>(
    token,
    `/v3/documents/${encodeURIComponent(documentId)}`,
    { method: 'DELETE', context: '删除会议记录' }
  );
}

export async function r2rRemoveDocumentFromCollection(
  token: string,
  collectionId: string,
  documentId: string
): Promise<void> {
  await r2rRequest<unknown>(
    token,
    `/v3/collections/${encodeURIComponent(
      collectionId
    )}/documents/${encodeURIComponent(documentId)}`,
    { method: 'DELETE', context: '移除会议记录' }
  );
}

/* ------------------------------------------------------------------ */
/* 分块                                                                */
/* ------------------------------------------------------------------ */

export async function r2rListChunks(
  token: string,
  documentId: string,
  options: { offset?: number; limit?: number } = {}
): Promise<{ chunks: R2rChunk[]; total: number }> {
  const offset = options.offset ?? 0;
  const limit = options.limit ?? 100;
  const payload = await r2rRequest<unknown>(
    token,
    `/v3/documents/${encodeURIComponent(documentId)}/chunks?offset=${offset}&limit=${limit}`,
    { context: '查询会议分块' }
  );
  const results = envelopeResults<R2rChunk[]>(payload);
  return {
    chunks: Array.isArray(results) ? results : [],
    total:
      envelopeTotal(payload) || (Array.isArray(results) ? results.length : 0),
  };
}

/** 统计文档分块数量（用于列表展示）。失败时返回 0。 */
export async function r2rCountChunks(
  token: string,
  documentId: string
): Promise<number> {
  try {
    const { total } = await r2rListChunks(token, documentId, {
      offset: 0,
      limit: 1,
    });
    return total;
  } catch {
    return 0;
  }
}

/** 读取 R2R access token 的过期时间（秒）；无法解析时返回 null。 */
export function r2rTokenExpiresAt(token: string): number | null {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }
  try {
    const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(
      Buffer.from(
        padded + '='.repeat((4 - (padded.length % 4)) % 4),
        'base64'
      ).toString('utf8')
    ) as { exp?: number };
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}
