'use client';

/**
 * 会议记录 Agent v0.1 —— AG-UI 客户端 Hook（T014）。
 *
 * 只通过同源 `/api/copilotkit` 与后端通信；浏览器不持有 Agent/R2R 凭据，
 * 也不提交 user_id / sources / answer_record 之类的身份字段。
 *
 * 服务端状态投影（契约 C05）：
 *   { meeting_scope, progress, answer_record, clarification }
 */

import {
  EventType,
  HttpAgent,
  type BaseEvent,
  type Message,
} from '@ag-ui/client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  ERROR_CATEGORIES,
  MeetingApiError,
  isErrorCategory,
  type HistoryResult,
} from '@/components/meeting/api';
import type {
  AnswerRecord,
  AnswerStatus,
  ErrorCategory,
  ScopeRequest,
  ScopeSnapshot,
} from '@/types/meeting-contracts';

export const AGUI_ENDPOINT = '/api/copilotkit';

export type RunStatus =
  | 'idle'
  | 'running'
  | 'completed'
  | 'incomplete'
  | 'failed'
  | 'interrupted';

export type TurnStatus = RunStatus | 'pending' | 'streaming';

export interface ChatTurn {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  answerRecord: AnswerRecord | null;
  status: TurnStatus;
  error: MeetingApiError | null;
  progress: string[];
  createdAt: string;
}

export interface MeetingAgentProjection {
  meeting_scope: ScopeSnapshot | null;
  progress: string[];
  answer_record: AnswerRecord | null;
  clarification: string | null;
}

const EMPTY_PROJECTION: MeetingAgentProjection = {
  meeting_scope: null,
  progress: [],
  answer_record: null,
  clarification: null,
};

/* ------------------------------------------------------------------ */
/* 工具                                                                */
/* ------------------------------------------------------------------ */

function randomId(): string {
  const cryptoRef =
    typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (cryptoRef && typeof cryptoRef.randomUUID === 'function') {
    return cryptoRef.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function cloneJson<T>(value: T): T {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return value;
  }
}

function decodeSegment(segment: string): string {
  return segment.replace(/~1/g, '/').replace(/~0/g, '~');
}

function pointerSegments(path: string): string[] {
  if (!path || path === '#') {
    return [];
  }
  return path.replace(/^#/, '').split('/').slice(1).map(decodeSegment);
}

function readPointer(root: unknown, segments: string[]): unknown {
  let current: unknown = root;
  for (const segment of segments) {
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index)) {
        return undefined;
      }
      current = current[index];
    } else if (current && typeof current === 'object') {
      current = (current as Record<string, unknown>)[segment];
    } else {
      return undefined;
    }
  }
  return current;
}

function writePointer(root: unknown, segments: string[], value: unknown): void {
  if (segments.length === 0) {
    return;
  }
  const parentSegments = segments.slice(0, -1);
  const key = segments[segments.length - 1];
  let parent: unknown = root;
  for (const segment of parentSegments) {
    if (Array.isArray(parent)) {
      parent = parent[Number(segment)];
    } else if (parent && typeof parent === 'object') {
      parent = (parent as Record<string, unknown>)[segment];
    } else {
      return;
    }
  }
  if (Array.isArray(parent)) {
    const index = key === '-' ? parent.length : Number(key);
    if (!Number.isInteger(index)) {
      return;
    }
    parent[index] = value;
  } else if (parent && typeof parent === 'object') {
    (parent as Record<string, unknown>)[key] = value;
  }
}

function removePointer(root: unknown, segments: string[]): void {
  if (segments.length === 0) {
    return;
  }
  const parentSegments = segments.slice(0, -1);
  const key = segments[segments.length - 1];
  let parent: unknown = root;
  for (const segment of parentSegments) {
    if (Array.isArray(parent)) {
      parent = parent[Number(segment)];
    } else if (parent && typeof parent === 'object') {
      parent = (parent as Record<string, unknown>)[segment];
    } else {
      return;
    }
  }
  if (Array.isArray(parent)) {
    const index = Number(key);
    if (Number.isInteger(index) && index >= 0 && index < parent.length) {
      parent.splice(index, 1);
    }
  } else if (parent && typeof parent === 'object') {
    delete (parent as Record<string, unknown>)[key];
  }
}

interface JsonPatchOperation {
  op: string;
  path: string;
  value?: unknown;
  from?: string;
}

/** 最小 JSON Patch（RFC 6902）实现：add / replace / remove / move / copy / test。 */
export function applyJsonPatch<T>(state: T, patch: unknown): T {
  if (!Array.isArray(patch)) {
    return state;
  }
  const next = cloneJson(state) as unknown;
  for (const rawOp of patch as JsonPatchOperation[]) {
    if (!rawOp || typeof rawOp.op !== 'string') {
      continue;
    }
    const segments = pointerSegments(rawOp.path ?? '');
    switch (rawOp.op) {
      case 'add':
        writePointer(next, segments, cloneJson(rawOp.value));
        break;
      case 'replace':
        writePointer(next, segments, cloneJson(rawOp.value));
        break;
      case 'remove':
        removePointer(next, segments);
        break;
      case 'move': {
        const from = pointerSegments(rawOp.from ?? '');
        const value = cloneJson(readPointer(next, from));
        removePointer(next, from);
        writePointer(next, segments, value);
        break;
      }
      case 'copy': {
        const from = pointerSegments(rawOp.from ?? '');
        const value = cloneJson(readPointer(next, from));
        writePointer(next, segments, value);
        break;
      }
      case 'test':
        break;
      default:
        break;
    }
  }
  return next as T;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string');
}

function asAnswerRecord(value: unknown): AnswerRecord | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as Partial<AnswerRecord>;
  if (typeof record.text !== 'string' || !record.sources) {
    return null;
  }
  return {
    ...(record as AnswerRecord),
    claims: Array.isArray(record.claims) ? record.claims : [],
    sources: (record.sources ?? {}) as AnswerRecord['sources'],
    coverage: record.coverage ?? { checked: [], unchecked: [], failed: [] },
  };
}

/** 把服务端状态投影解析为页面使用的四个字段。 */
export function parseProjection(raw: unknown): MeetingAgentProjection {
  if (!raw || typeof raw !== 'object') {
    return EMPTY_PROJECTION;
  }
  const record = raw as Record<string, unknown>;
  const scope =
    record.meeting_scope && typeof record.meeting_scope === 'object'
      ? (record.meeting_scope as ScopeSnapshot)
      : null;
  return {
    meeting_scope: scope,
    progress: asStringArray(record.progress),
    answer_record: asAnswerRecord(record.answer_record),
    clarification:
      typeof record.clarification === 'string' ? record.clarification : null,
  };
}

function categoryFromRunError(message: string, code?: string): ErrorCategory {
  if (isErrorCategory(code)) {
    return code;
  }
  const found = ERROR_CATEGORIES.find((category) => message.includes(category));
  return found ?? 'service_failure';
}

function answerStatusOf(record: AnswerRecord | null): AnswerStatus | null {
  if (!record) {
    return null;
  }
  if (
    record.status === 'completed' ||
    record.status === 'failed' ||
    record.status === 'interrupted'
  ) {
    return record.status;
  }
  return 'interrupted';
}

/* ------------------------------------------------------------------ */
/* Hook                                                                */
/* ------------------------------------------------------------------ */

export interface UseMeetingAgentOptions {
  threadId: string;
  initialMessages?: Message[];
}

export interface UseMeetingAgentResult {
  status: RunStatus;
  turns: ChatTurn[];
  draft: string;
  progress: string[];
  answerRecord: AnswerRecord | null;
  clarification: string | null;
  meetingScope: ScopeSnapshot | null;
  error: MeetingApiError | null;
  send: (question: string, scope: ScopeRequest) => Promise<void>;
  abort: () => void;
  reset: () => void;
  restore: (history: HistoryResult) => void;
  seedMessages: (messages: Message[]) => void;
}

export function useMeetingAgent(
  options: UseMeetingAgentOptions
): UseMeetingAgentResult {
  const { threadId } = options;

  const agentRef = useRef<HttpAgent | null>(null);
  const subscriptionRef = useRef<{ unsubscribe: () => void } | null>(null);
  const projectionRef = useRef<MeetingAgentProjection>(EMPTY_PROJECTION);
  const buffersRef = useRef<Record<string, string>>({});
  const activeMessageRef = useRef<string | null>(null);
  const turnsRef = useRef<ChatTurn[]>([]);
  const initialMessagesRef = useRef<Message[]>(options.initialMessages ?? []);

  const [status, setStatus] = useState<RunStatus>('idle');
  const [turns, setTurnsState] = useState<ChatTurn[]>([]);
  const [draft, setDraft] = useState('');
  const [projection, setProjection] =
    useState<MeetingAgentProjection>(EMPTY_PROJECTION);
  const [error, setError] = useState<MeetingApiError | null>(null);

  const setTurns = useCallback(
    (next: ChatTurn[] | ((prev: ChatTurn[]) => ChatTurn[])) => {
      setTurnsState((prev) => {
        const value =
          typeof next === 'function'
            ? (next as (p: ChatTurn[]) => ChatTurn[])(prev)
            : next;
        turnsRef.current = value;
        return value;
      });
    },
    []
  );

  const updateProjection = useCallback((next: MeetingAgentProjection) => {
    projectionRef.current = next;
    setProjection(next);
  }, []);

  const handleEvent = useCallback(
    (event: BaseEvent) => {
      switch (event.type) {
        case EventType.STATE_SNAPSHOT: {
          const snapshot = (event as { snapshot?: unknown }).snapshot;
          updateProjection(parseProjection(snapshot));
          break;
        }
        case EventType.STATE_DELTA: {
          const delta = (event as { delta?: unknown }).delta;
          const next = applyJsonPatch(
            projectionRef.current,
            delta
          ) as MeetingAgentProjection;
          updateProjection(parseProjection(next));
          break;
        }
        case EventType.TEXT_MESSAGE_START: {
          const messageId = String(
            (event as { messageId?: string }).messageId ?? ''
          );
          buffersRef.current[messageId] = '';
          activeMessageRef.current = messageId;
          break;
        }
        case EventType.TEXT_MESSAGE_CONTENT: {
          const payload = event as { messageId?: string; delta?: string };
          const messageId = String(payload.messageId ?? '');
          const key = messageId || (activeMessageRef.current ?? '');
          if (!key) {
            break;
          }
          buffersRef.current[key] =
            (buffersRef.current[key] ?? '') + (payload.delta ?? '');
          setDraft(buffersRef.current[key] ?? '');
          break;
        }
        case EventType.TEXT_MESSAGE_END: {
          const messageId = String(
            (event as { messageId?: string }).messageId ?? ''
          );
          const key = messageId || (activeMessageRef.current ?? '');
          const text = buffersRef.current[key] ?? '';
          delete buffersRef.current[key];
          if (key === activeMessageRef.current) {
            activeMessageRef.current = null;
          }
          setTurns((prev) =>
            prev.map((turn) =>
              turn.role === 'assistant' && turn.status === 'streaming'
                ? { ...turn, content: text }
                : turn
            )
          );
          setDraft('');
          break;
        }
        default:
          break;
      }
    },
    [setTurns, updateProjection]
  );

  const ensureAgent = useCallback(() => {
    if (agentRef.current) {
      return agentRef.current;
    }
    const agent = new HttpAgent({
      url: AGUI_ENDPOINT,
      threadId,
      initialMessages: initialMessagesRef.current,
    });
    agentRef.current = agent;

    subscriptionRef.current = agent.subscribe({
      onEvent: ({ event }) => {
        handleEvent(event);
      },
      onRunErrorEvent: ({ event }) => {
        const message = event.message || '运行失败，请稍后重试。';
        const apiError = new MeetingApiError({
          category: categoryFromRunError(message, event.code),
          message,
          retryable: true,
        });
        setError(apiError);
        setStatus('failed');
        setTurns((prev) =>
          prev.map((turn) =>
            turn.role === 'assistant' && turn.status === 'streaming'
              ? {
                  ...turn,
                  status: 'failed',
                  error: apiError,
                  content: turn.content,
                }
              : turn
          )
        );
      },
      onRunFinishedEvent: ({ outcome }) => {
        const record = projectionRef.current.answer_record;
        const answerStatus = answerStatusOf(record);
        const nextStatus: RunStatus =
          outcome === 'interrupt' || outcome === 'cancelled'
            ? 'interrupted'
            : answerStatus === 'completed'
              ? 'completed'
              : answerStatus === 'failed'
                ? 'failed'
                : 'incomplete';
        setStatus(nextStatus);
        setTurns((prev) =>
          prev.map((turn) =>
            turn.role === 'assistant' && turn.status === 'streaming'
              ? {
                  ...turn,
                  status: nextStatus,
                  answerRecord: record,
                  content:
                    record?.text && answerStatus === 'completed'
                      ? record.text
                      : turn.content,
                  progress: projectionRef.current.progress,
                }
              : turn
          )
        );
      },
      onRunFailed: ({ error: runError }) => {
        const message =
          runError instanceof Error
            ? runError.message
            : '运行失败，请稍后重试。';
        const apiError = new MeetingApiError({
          category: categoryFromRunError(message),
          message,
          retryable: true,
        });
        setError(apiError);
        setStatus('failed');
        setTurns((prev) =>
          prev.map((turn) =>
            turn.role === 'assistant' && turn.status === 'streaming'
              ? { ...turn, status: 'failed', error: apiError }
              : turn
          )
        );
      },
    });

    return agent;
  }, [handleEvent, setTurns, threadId]);

  useEffect(() => {
    // 线程切换时重建 Agent，避免把上一线程的消息带给下一线程。
    subscriptionRef.current?.unsubscribe();
    subscriptionRef.current = null;
    agentRef.current = null;
    buffersRef.current = {};
    activeMessageRef.current = null;
    initialMessagesRef.current = [];
    projectionRef.current = EMPTY_PROJECTION;
    updateProjection(EMPTY_PROJECTION);
    setTurns([]);
    setDraft('');
    setError(null);
    setStatus('idle');
  }, [threadId, setTurns, updateProjection]);

  useEffect(
    () => () => {
      subscriptionRef.current?.unsubscribe();
      subscriptionRef.current = null;
      agentRef.current?.abortRun();
    },
    []
  );

  const send = useCallback(
    async (question: string, scope: ScopeRequest) => {
      const trimmed = question.trim();
      if (!trimmed) {
        return;
      }
      const agent = ensureAgent();
      const userTurn: ChatTurn = {
        id: randomId(),
        role: 'user',
        content: trimmed,
        answerRecord: null,
        status: 'completed',
        error: null,
        progress: [],
        createdAt: new Date().toISOString(),
      };
      const assistantId = randomId();
      setError(null);
      setStatus('running');
      setTurns((prev) => [
        ...prev,
        userTurn,
        {
          id: assistantId,
          role: 'assistant',
          content: '',
          answerRecord: null,
          status: 'streaming',
          error: null,
          progress: [],
          createdAt: new Date().toISOString(),
        },
      ]);

      agent.addMessage({
        id: userTurn.id,
        role: 'user',
        content: trimmed,
      });

      try {
        await agent.runAgent({
          forwardedProps: {
            meeting_scope: {
              collection_id: scope.collection_id,
              mode: scope.mode,
              ...(scope.mode === 'explicit'
                ? { document_ids: scope.document_ids ?? [] }
                : {}),
            },
          },
        });
      } catch (runError) {
        const message =
          runError instanceof Error
            ? runError.message
            : '运行失败，请稍后重试。';
        const apiError = new MeetingApiError({
          category: categoryFromRunError(message),
          message,
          retryable: true,
        });
        setError(apiError);
        setStatus('failed');
        setTurns((prev) =>
          prev.map((turn) =>
            turn.id === assistantId
              ? { ...turn, status: 'failed', error: apiError }
              : turn
          )
        );
      }
    },
    [ensureAgent, setTurns]
  );

  const abort = useCallback(() => {
    agentRef.current?.abortRun();
    setStatus('interrupted');
    setTurns((prev) =>
      prev.map((turn) =>
        turn.role === 'assistant' && turn.status === 'streaming'
          ? { ...turn, status: 'interrupted' }
          : turn
      )
    );
  }, [setTurns]);

  const reset = useCallback(() => {
    buffersRef.current = {};
    activeMessageRef.current = null;
    projectionRef.current = EMPTY_PROJECTION;
    updateProjection(EMPTY_PROJECTION);
    setTurns([]);
    setDraft('');
    setError(null);
    setStatus('idle');
  }, [setTurns, updateProjection]);

  const restore = useCallback(
    (history: HistoryResult) => {
      const recordsByMessage = new Map<string, AnswerRecord>();
      for (const record of history.answer_records ?? []) {
        if (record?.message_id) {
          recordsByMessage.set(record.message_id, record);
        }
      }
      const restored: ChatTurn[] = history.messages.map((message) => {
        const record = recordsByMessage.get(message.id) ?? null;
        if (message.role === 'user') {
          return {
            id: message.id || randomId(),
            role: 'user',
            content: message.content,
            answerRecord: null,
            status: 'completed',
            error: null,
            progress: [],
            createdAt: new Date().toISOString(),
          };
        }
        const answerStatus = answerStatusOf(record);
        const content = record?.text ?? message.content;
        return {
          id: message.id || randomId(),
          role: 'assistant',
          content,
          answerRecord: record,
          status: answerStatus ?? 'incomplete',
          error: null,
          progress: [],
          createdAt: new Date().toISOString(),
        };
      });

      setTurns(restored);
      const projection: MeetingAgentProjection = {
        meeting_scope: history.scope,
        progress: [],
        answer_record:
          history.answer_records?.[history.answer_records.length - 1] ?? null,
        clarification: null,
      };
      updateProjection(projection);
      setStatus(
        history.run_status === 'failed'
          ? 'failed'
          : history.run_status === 'interrupted'
            ? 'interrupted'
            : 'idle'
      );
    },
    [setTurns, updateProjection]
  );

  const seedMessages = useCallback(
    (messages: Message[]) => {
      initialMessagesRef.current = messages;
      const agent = ensureAgent();
      agent.setMessages(messages);
    },
    [ensureAgent]
  );

  return useMemo(
    () => ({
      status,
      turns,
      draft,
      progress: projection.progress,
      answerRecord: projection.answer_record,
      clarification: projection.clarification,
      meetingScope: projection.meeting_scope,
      error,
      send,
      abort,
      reset,
      restore,
      seedMessages,
    }),
    [
      abort,
      draft,
      error,
      projection.answer_record,
      projection.clarification,
      projection.meeting_scope,
      projection.progress,
      reset,
      restore,
      seedMessages,
      send,
      status,
      turns,
    ]
  );
}

export default useMeetingAgent;
