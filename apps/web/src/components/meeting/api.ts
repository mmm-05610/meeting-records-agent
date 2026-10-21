/**
 * 会议记录 Agent v0.1 —— 同源 API 客户端。
 *
 * 只按 docs/web-api-v0.1.md 的契约调用本应用的 Pages Router API；
 * 浏览器不持有 R2R / Agent 凭据，也不直接访问它们的服务地址。
 */

import type {
  AnswerRecord,
  DocumentStatus,
  ErrorCategory,
  RecordKind,
  ScopeSnapshot,
  TimePrecision,
} from '@/types/meeting-contracts';

/* ------------------------------------------------------------------ */
/* 错误模型（C08）                                                      */
/* ------------------------------------------------------------------ */

export const ERROR_CATEGORY_LABELS: Record<ErrorCategory, string> = {
  input_error: '输入有误',
  scope_forbidden: '没有访问权限',
  duplicate_processing: '重复提交',
  unknown_result: '结果未知',
  service_failure: '服务故障',
  budget_exceeded: '超出阅读预算',
  invalid_citation: '引用无效',
  stale_scope: '范围已变化',
};

export const ERROR_CATEGORIES: ErrorCategory[] = [
  'input_error',
  'scope_forbidden',
  'duplicate_processing',
  'unknown_result',
  'service_failure',
  'budget_exceeded',
  'invalid_citation',
  'stale_scope',
];

const URL_PATTERN = /https?:\/\/\S+/gi;
const SECRET_PATTERN = /\b[A-Za-z0-9_-]{32,}\b/g;

/**
 * 去掉可能出现在服务端消息里的内部地址与凭据；
 * 页面只显示可读的中文提示。
 */
export function sanitizeMessage(message: string): string {
  return message
    .replace(URL_PATTERN, '[内部地址已隐藏]')
    .replace(SECRET_PATTERN, '[凭据已隐藏]');
}

export function isErrorCategory(value: unknown): value is ErrorCategory {
  return (
    typeof value === 'string' && (ERROR_CATEGORIES as string[]).includes(value)
  );
}

export class MeetingApiError extends Error {
  readonly category: ErrorCategory;
  readonly fields: string[];
  readonly retryable: boolean;
  readonly status?: number;

  constructor(params: {
    category: ErrorCategory;
    message: string;
    fields?: string[];
    retryable?: boolean;
    status?: number;
  }) {
    super(sanitizeMessage(params.message));
    this.name = 'MeetingApiError';
    this.category = params.category;
    this.fields = params.fields ?? [];
    this.retryable = params.retryable ?? false;
    this.status = params.status;
  }

  /** 面向用户的中文提示（不含内部地址、token 或内部提示）。 */
  get label(): string {
    return ERROR_CATEGORY_LABELS[this.category] ?? '请求失败';
  }
}

/** 把接口返回的字段名映射为表单字段，便于把错误定位到具体输入框。 */
export const FIELD_LABELS: Record<string, string> = {
  file: '文件',
  title: '标题',
  meeting_date: '会议日期',
  record_kind: '记录类型',
  participants: '参与人',
  time_precision: '时间精度',
  meeting_started_at: '会议开始时间',
  name: '项目名称',
  description: '项目描述',
  collection_id: '项目',
  mode: '范围模式',
  document_ids: '会议范围',
};

export function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field;
}

function defaultMessage(status: number): string {
  if (status === 401) {
    return '尚未登录或登录已过期，请重新登录。';
  }
  if (status === 404) {
    return '请求的内容不存在或已被删除。';
  }
  if (status >= 500) {
    return '服务端处理失败，请稍后重试。';
  }
  return '请求失败，请稍后重试。';
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      credentials: 'same-origin',
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init?.body instanceof FormData
          ? {}
          : { 'Content-Type': 'application/json' }),
        ...(init?.headers ?? {}),
      },
    });
  } catch {
    throw new MeetingApiError({
      category: 'service_failure',
      message: '无法连接服务，请确认服务已启动后重试。',
      retryable: true,
    });
  }

  const raw = await response.text();
  let payload: unknown = null;
  if (raw) {
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const envelope = (payload as { error?: Record<string, unknown> } | null)
      ?.error;
    const category = isErrorCategory(envelope?.category)
      ? envelope.category
      : response.status === 401 || response.status === 403
        ? 'scope_forbidden'
        : response.status === 404
          ? 'invalid_citation'
          : response.status === 409
            ? 'duplicate_processing'
            : response.status === 400
              ? 'input_error'
              : 'service_failure';
    const message =
      typeof envelope?.message === 'string' && envelope.message.trim()
        ? envelope.message
        : defaultMessage(response.status);
    const fields = Array.isArray(envelope?.fields)
      ? (envelope.fields as unknown[]).filter(
          (item): item is string => typeof item === 'string'
        )
      : [];
    throw new MeetingApiError({
      category,
      message,
      fields,
      retryable:
        typeof envelope?.retryable === 'boolean'
          ? envelope.retryable
          : response.status >= 500,
      status: response.status,
    });
  }

  return (payload ?? {}) as T;
}

/* ------------------------------------------------------------------ */
/* 数据模型                                                            */
/* ------------------------------------------------------------------ */

export interface ProjectSummary {
  id: string;
  name: string;
  description?: string | null;
  created_at?: string | null;
}

export interface MeetingSummary {
  document_id: string;
  collection_id: string;
  title: string;
  meeting_date: string;
  time_precision: TimePrecision;
  meeting_started_at: string | null;
  record_kind: RecordKind;
  participants: string[];
  content_sha256: string;
  status: DocumentStatus;
  chunk_count: number;
  size_in_bytes: number;
  created_at: string;
  identity_verified: boolean;
}

export interface ChunkItem {
  chunk_id: string;
  chunk_order: number;
  text: string;
}

export interface ChunksPage {
  page: number;
  page_size: number;
  total: number;
  items: ChunkItem[];
}

export interface DeleteMeetingResult {
  deleted: boolean;
  document_id: string;
  file_deleted: boolean;
  chunks_deleted: boolean;
}

export interface ThreadSummary {
  thread_id: string;
  title: string;
  updated_at?: string | null;
  created_at?: string | null;
}

export interface HistoryMessage {
  id: string;
  role: string;
  content: string;
}

export interface HistoryResult {
  messages: HistoryMessage[];
  answer_records: AnswerRecord[];
  scope: ScopeSnapshot | null;
  run_status: string | null;
}

/* ------------------------------------------------------------------ */
/* 归一化（后端字段可能缺失，页面不得因为缺字段而崩溃）                  */
/* ------------------------------------------------------------------ */

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function bool(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function strArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string');
}

function normalizeStatus(value: unknown): DocumentStatus {
  switch (value) {
    case 'ready':
    case 'processing':
    case 'failed':
    case 'unknown':
      return value;
    default:
      return 'unknown';
  }
}

function normalizeRecordKind(value: unknown): RecordKind {
  return value === 'transcript' ? 'transcript' : 'minutes';
}

function normalizeTimePrecision(value: unknown): TimePrecision {
  return value === 'datetime' ? 'datetime' : 'date';
}

export function normalizeProject(raw: unknown): ProjectSummary {
  const record = (raw ?? {}) as Record<string, unknown>;
  return {
    id: str(record.id),
    name: str(record.name, '未命名项目'),
    description:
      typeof record.description === 'string' ? record.description : null,
    created_at:
      typeof record.created_at === 'string' ? record.created_at : null,
  };
}

export function normalizeMeeting(raw: unknown): MeetingSummary {
  const record = (raw ?? {}) as Record<string, unknown>;
  return {
    document_id: str(record.document_id ?? record.id),
    collection_id: str(record.collection_id),
    title: str(record.title, '未命名会议'),
    meeting_date: str(record.meeting_date),
    time_precision: normalizeTimePrecision(record.time_precision),
    meeting_started_at:
      typeof record.meeting_started_at === 'string'
        ? record.meeting_started_at
        : null,
    record_kind: normalizeRecordKind(record.record_kind),
    participants: strArray(record.participants),
    content_sha256: str(record.content_sha256),
    status: normalizeStatus(record.status),
    chunk_count: num(record.chunk_count),
    size_in_bytes: num(record.size_in_bytes),
    created_at: str(record.created_at),
    identity_verified: bool(record.identity_verified, true),
  };
}

export function normalizeChunk(raw: unknown): ChunkItem {
  const record = (raw ?? {}) as Record<string, unknown>;
  return {
    chunk_id: str(record.chunk_id ?? record.id),
    chunk_order: num(record.chunk_order),
    text: str(record.text),
  };
}

export function normalizeChunksPage(raw: unknown): ChunksPage {
  const record = (raw ?? {}) as Record<string, unknown>;
  const items = Array.isArray(record.items)
    ? (record.items as unknown[]).map(normalizeChunk)
    : [];
  return {
    page: num(record.page),
    page_size: num(record.page_size, 20) || 20,
    total: num(record.total, items.length),
    items,
  };
}

export function normalizeThread(raw: unknown): ThreadSummary {
  const record = (raw ?? {}) as Record<string, unknown>;
  const threadId = str(record.thread_id ?? record.threadId ?? record.id);
  return {
    thread_id: threadId,
    title: str(record.title ?? record.name ?? record.summary, '') || threadId,
    updated_at:
      typeof record.updated_at === 'string'
        ? record.updated_at
        : typeof record.updatedAt === 'string'
          ? record.updatedAt
          : null,
    created_at:
      typeof record.created_at === 'string' ? record.created_at : null,
  };
}

function contentToText(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') {
          return part;
        }
        if (part && typeof part === 'object') {
          const record = part as Record<string, unknown>;
          if (typeof record.text === 'string') {
            return record.text;
          }
        }
        return '';
      })
      .join('');
  }
  return '';
}

export function normalizeHistoryMessage(raw: unknown): HistoryMessage {
  const record = (raw ?? {}) as Record<string, unknown>;
  return {
    id: str(record.id ?? record.message_id),
    role: str(record.role, 'assistant'),
    content: contentToText(record.content ?? record.text),
  };
}

/* ------------------------------------------------------------------ */
/* 接口                                                                */
/* ------------------------------------------------------------------ */

export async function fetchProjects(): Promise<ProjectSummary[]> {
  const data = await request<{ projects?: unknown }>('/api/projects');
  const list = Array.isArray(data?.projects) ? data.projects : [];
  return list.map(normalizeProject).filter((project) => project.id);
}

export async function createProject(
  name: string,
  description?: string
): Promise<ProjectSummary> {
  const data = await request<{ project?: unknown }>('/api/projects', {
    method: 'POST',
    body: JSON.stringify({
      name,
      ...(description && description.trim() ? { description } : {}),
    }),
  });
  return normalizeProject(data?.project);
}

export async function fetchProjectMeetings(
  projectId: string,
  status: 'all' | 'ready' = 'all'
): Promise<MeetingSummary[]> {
  const data = await request<{ meetings?: unknown }>(
    `/api/projects/${encodeURIComponent(projectId)}/meetings?status=${status}`
  );
  const list = Array.isArray(data?.meetings) ? data.meetings : [];
  return list.map(normalizeMeeting).filter((meeting) => meeting.document_id);
}

export interface UploadMeetingInput {
  file: File;
  title: string;
  meeting_date: string;
  record_kind: RecordKind;
  participants: string[];
  time_precision: TimePrecision;
  meeting_started_at?: string;
}

export async function uploadMeeting(
  projectId: string,
  input: UploadMeetingInput
): Promise<{ meeting: MeetingSummary; existing: boolean }> {
  const form = new FormData();
  form.append('file', input.file);
  form.append('title', input.title);
  form.append('meeting_date', input.meeting_date);
  form.append('record_kind', input.record_kind);
  form.append('participants', JSON.stringify(input.participants));
  form.append('time_precision', input.time_precision);
  if (input.meeting_started_at) {
    form.append('meeting_started_at', input.meeting_started_at);
  }

  const data = await request<{ meeting?: unknown; existing?: unknown }>(
    `/api/projects/${encodeURIComponent(projectId)}/meetings`,
    { method: 'POST', body: form }
  );
  return {
    meeting: normalizeMeeting(data?.meeting),
    existing: data?.existing === true,
  };
}

export async function fetchMeeting(
  documentId: string
): Promise<{ meeting: MeetingSummary; chunks: ChunksPage }> {
  const data = await request<{ meeting?: unknown; chunks?: unknown }>(
    `/api/meetings/${encodeURIComponent(documentId)}`
  );
  return {
    meeting: normalizeMeeting(data?.meeting),
    chunks: normalizeChunksPage(data?.chunks),
  };
}

export async function deleteMeeting(
  documentId: string
): Promise<DeleteMeetingResult> {
  const data = await request<Partial<DeleteMeetingResult>>(
    `/api/meetings/${encodeURIComponent(documentId)}`,
    { method: 'DELETE' }
  );
  return {
    deleted: data?.deleted === true,
    document_id: str(data?.document_id, documentId),
    file_deleted: data?.file_deleted === true,
    chunks_deleted: data?.chunks_deleted === true,
  };
}

export async function fetchChunks(
  documentId: string,
  page: number,
  pageSize = 50
): Promise<ChunksPage> {
  const data = await request<{ chunks?: unknown }>(
    `/api/meetings/${encodeURIComponent(documentId)}/chunks?page=${page}&page_size=${pageSize}`
  );
  return normalizeChunksPage(data?.chunks);
}

export async function fetchChunkNeighbors(
  documentId: string,
  chunkId: string,
  radius = 1
): Promise<ChunkItem[]> {
  const data = await request<{ items?: unknown }>(
    `/api/meetings/${encodeURIComponent(
      documentId
    )}/chunks/${encodeURIComponent(chunkId)}/neighbors?radius=${radius}`
  );
  const list = Array.isArray(data?.items) ? data.items : [];
  return list.map(normalizeChunk);
}

export async function fetchThreads(): Promise<ThreadSummary[]> {
  const data = await request<{ threads?: unknown } | unknown[]>('/api/threads');
  const list = Array.isArray(data)
    ? data
    : Array.isArray((data as { threads?: unknown })?.threads)
      ? ((data as { threads: unknown[] }).threads as unknown[])
      : [];
  return list.map(normalizeThread).filter((thread) => thread.thread_id);
}

export async function fetchHistory(threadId: string): Promise<HistoryResult> {
  const data = await request<{
    messages?: unknown;
    answer_records?: unknown;
    scope?: unknown;
    run_status?: unknown;
  }>('/api/history', {
    method: 'POST',
    body: JSON.stringify({ thread_id: threadId }),
  });

  const answerRecords = Array.isArray(data?.answer_records)
    ? (data.answer_records as AnswerRecord[])
    : [];
  const scope = (data?.scope ?? null) as ScopeSnapshot | null;

  return {
    messages: Array.isArray(data?.messages)
      ? (data.messages as unknown[]).map(normalizeHistoryMessage)
      : [],
    answer_records: answerRecords,
    scope,
    run_status: typeof data?.run_status === 'string' ? data.run_status : null,
  };
}

/** 会话是否已登录（服务端确认，不依赖浏览器缓存的登录态）。 */
export async function fetchSession(): Promise<{
  user: { id: string; email: string } | null;
}> {
  try {
    const data = await request<{ user?: { id?: string; email?: string } }>(
      '/api/me'
    );
    return {
      user: {
        id: str(data?.user?.id),
        email: str(data?.user?.email),
      },
    };
  } catch {
    return { user: null };
  }
}
