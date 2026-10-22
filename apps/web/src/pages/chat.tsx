'use client';

import { PanelLeft, Send, Square } from 'lucide-react';
import { useRouter } from 'next/router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

import Layout from '@/components/Layout';
import { AnswerPanel } from '@/components/meeting/answer-panel';
import {
  MeetingApiError,
  fetchHistory,
  fetchProjectMeetings,
  fetchProjects,
  fetchThreads,
  type MeetingSummary,
  type ProjectSummary,
  type ThreadSummary,
} from '@/components/meeting/api';
import type { SourceEntry } from '@/components/meeting/citations';
import { EmptyBlock, LoadingBlock } from '@/components/meeting/empty-state';
import { ErrorNotice } from '@/components/meeting/error-notice';
import { ScopePicker } from '@/components/meeting/scope-picker';
import { SourceDialog } from '@/components/meeting/source-dialog';
import { ThreadList } from '@/components/meeting/thread-list';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/textarea';
import { useMeetingAgent } from '@/hooks/use-meeting-agent';
import type { ScopeMode } from '@/types/meeting-contracts';

const THREAD_STORAGE_KEY = 'mra.thread_id';

function createThreadId(): string {
  if (
    typeof globalThis !== 'undefined' &&
    globalThis.crypto &&
    typeof globalThis.crypto.randomUUID === 'function'
  ) {
    return globalThis.crypto.randomUUID();
  }
  return `thread-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const ChatPage: React.FC = () => {
  const router = useRouter();

  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [projectsError, setProjectsError] = useState<MeetingApiError | null>(
    null
  );

  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [mode, setMode] = useState<ScopeMode>('all_ready');
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<string[]>([]);
  const [meetings, setMeetings] = useState<MeetingSummary[]>([]);
  const [meetingsLoading, setMeetingsLoading] = useState(false);
  const [meetingsError, setMeetingsError] = useState<MeetingApiError | null>(
    null
  );

  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [threadsLoading, setThreadsLoading] = useState(true);
  const [threadId, setThreadId] = useState('');

  const [question, setQuestion] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<MeetingApiError | null>(
    null
  );
  const [sourceEntry, setSourceEntry] = useState<SourceEntry | null>(null);
  const [sourceOpen, setSourceOpen] = useState(false);

  const agent = useMeetingAgent({ threadId: threadId || 'pending' });

  /* ---------------- 项目与会议 ---------------- */

  const loadProjects = useCallback(async () => {
    setProjectsLoading(true);
    setProjectsError(null);
    try {
      const list = await fetchProjects();
      setProjects(list);
      setSelectedProjectId((current) => {
        if (current && list.some((project) => project.id === current)) {
          return current;
        }
        const fromQuery =
          typeof router.query.project === 'string' ? router.query.project : '';
        if (fromQuery && list.some((project) => project.id === fromQuery)) {
          return fromQuery;
        }
        return list[0]?.id ?? '';
      });
    } catch (error) {
      setProjects([]);
      setProjectsError(
        error instanceof MeetingApiError
          ? error
          : new MeetingApiError({
              category: 'service_failure',
              message: '读取项目失败，请稍后重试。',
              retryable: true,
            })
      );
    } finally {
      setProjectsLoading(false);
    }
  }, [router.query.project]);

  const loadMeetings = useCallback(async (projectId: string) => {
    if (!projectId) {
      setMeetings([]);
      setMeetingsError(null);
      return;
    }
    setMeetingsLoading(true);
    setMeetingsError(null);
    try {
      const list = await fetchProjectMeetings(projectId, 'all');
      setMeetings(list);
    } catch (error) {
      setMeetings([]);
      setMeetingsError(
        error instanceof MeetingApiError
          ? error
          : new MeetingApiError({
              category: 'service_failure',
              message: '读取会议列表失败，请稍后重试。',
              retryable: true,
            })
      );
    } finally {
      setMeetingsLoading(false);
    }
  }, []);

  const loadThreads = useCallback(async () => {
    setThreadsLoading(true);
    try {
      const list = await fetchThreads();
      setThreads(list);
    } catch {
      setThreads([]);
    } finally {
      setThreadsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProjects();
    void loadThreads();
  }, [loadProjects, loadThreads]);

  useEffect(() => {
    void loadMeetings(selectedProjectId);
  }, [loadMeetings, selectedProjectId]);

  /* ---------------- 线程与历史恢复 ---------------- */

  useEffect(() => {
    if (!router.isReady) {
      return;
    }
    const fromQuery =
      typeof router.query.thread === 'string' ? router.query.thread : '';
    const stored =
      typeof window !== 'undefined'
        ? (window.localStorage.getItem(THREAD_STORAGE_KEY) ?? '')
        : '';
    const initial = fromQuery || stored || createThreadId();
    setThreadId(initial);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(THREAD_STORAGE_KEY, initial);
    }
    if (!fromQuery) {
      void router.replace(
        {
          pathname: '/chat',
          query: { ...router.query, thread: initial },
        },
        undefined,
        { shallow: true }
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady, router.query.thread]);

  useEffect(() => {
    if (!threadId || threadId === 'pending') {
      return;
    }
    let cancelled = false;
    const restore = async () => {
      setHistoryLoading(true);
      setHistoryError(null);
      try {
        const history = await fetchHistory(threadId);
        if (cancelled) {
          return;
        }
        agent.restore(history);
        const recordsByMessage = new Map<string, string>();
        for (const record of history.answer_records ?? []) {
          if (record?.message_id) {
            recordsByMessage.set(record.message_id, record.text ?? '');
          }
        }
        agent.seedMessages(
          history.messages.map((message) => ({
            id: message.id,
            role: message.role === 'user' ? 'user' : 'assistant',
            content: recordsByMessage.get(message.id) ?? message.content,
          }))
        );
        if (history.scope?.collection_id) {
          setSelectedProjectId(history.scope.collection_id);
          setMode(history.scope.mode);
          setSelectedDocumentIds(
            (history.scope.documents ?? []).map((doc) => doc.document_id)
          );
        }
      } catch (error) {
        if (cancelled) {
          return;
        }
        const apiError =
          error instanceof MeetingApiError
            ? error
            : new MeetingApiError({
                category: 'service_failure',
                message: '恢复历史线程失败，请稍后重试。',
                retryable: true,
              });
        if (apiError.category === 'scope_forbidden') {
          // Legacy threads (created before account binding) cannot be restored.
          // Start a clean thread instead of leaving the user on a broken session.
          const fresh = createThreadId();
          setThreadId(fresh);
          agent.reset();
          if (typeof window !== 'undefined') {
            window.localStorage.setItem(THREAD_STORAGE_KEY, fresh);
          }
          void router.replace(
            {
              pathname: '/chat',
              query: { ...router.query, thread: fresh },
            },
            undefined,
            { shallow: true }
          );
          setHistoryError(
            new MeetingApiError({
              category: 'scope_forbidden',
              message:
                '该历史会话来自旧版本或不属于当前账号，已为你新建会话；请重新提问。',
              retryable: false,
            })
          );
        } else {
          setHistoryError(apiError);
        }
      } finally {
        if (!cancelled) {
          setHistoryLoading(false);
        }
      }
    };
    void restore();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  const handleSelectThread = useCallback(
    (nextThreadId: string) => {
      if (nextThreadId === threadId) {
        return;
      }
      setThreadId(nextThreadId);
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(THREAD_STORAGE_KEY, nextThreadId);
      }
      void router.replace(
        {
          pathname: '/chat',
          query: { ...router.query, thread: nextThreadId },
        },
        undefined,
        { shallow: true }
      );
    },
    [router, threadId]
  );

  const handleNewThread = useCallback(() => {
    const next = createThreadId();
    setThreadId(next);
    agent.reset();
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(THREAD_STORAGE_KEY, next);
    }
    void router.replace(
      {
        pathname: '/chat',
        query: { ...router.query, thread: next },
      },
      undefined,
      { shallow: true }
    );
  }, [agent, router]);

  /* ---------------- 交互 ---------------- */

  const handleToggleDocument = useCallback((documentId: string) => {
    setSelectedDocumentIds((current) =>
      current.includes(documentId)
        ? current.filter((id) => id !== documentId)
        : [...current, documentId]
    );
  }, []);

  const submitQuestion = useCallback(async () => {
    const text = question.trim();
    if (!text) {
      return;
    }
    if (!selectedProjectId) {
      setInputError('请先选择要提问的项目。');
      return;
    }
    if (mode === 'explicit' && selectedDocumentIds.length === 0) {
      setInputError('指定会议模式至少需要选择一场已就绪的会议。');
      return;
    }
    setInputError(null);
    setQuestion('');
    await agent.send(text, {
      collection_id: selectedProjectId,
      mode,
      document_ids: mode === 'explicit' ? selectedDocumentIds : undefined,
    });
    void loadThreads();
  }, [
    agent,
    loadThreads,
    mode,
    question,
    selectedDocumentIds,
    selectedProjectId,
  ]);

  const handleSend = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await submitQuestion();
  };

  const handleOpenSource = useCallback((entry: SourceEntry) => {
    setSourceEntry(entry);
    setSourceOpen(true);
  }, []);

  const scopeSummary = useMemo(() => {
    const project = projects.find((item) => item.id === selectedProjectId);
    if (!project) {
      return '未选择项目';
    }
    if (mode === 'all_ready') {
      const ready = meetings.filter((item) => item.status === 'ready').length;
      return `${project.name} · 全部已就绪会议（${ready} 场）`;
    }
    return `${project.name} · 指定 ${selectedDocumentIds.length} 场会议`;
  }, [meetings, mode, projects, selectedDocumentIds, selectedProjectId]);

  const running = agent.status === 'running';

  return (
    <Layout pageTitle="问答" includeFooter={false}>
      <main className="flex h-screen-[calc(100%-4rem)] overflow-hidden">
        {/* 侧栏：范围与线程 */}
        <aside
          className={`${
            panelOpen ? 'fixed inset-y-0 left-0 z-40 block' : 'hidden'
          } w-[19rem] shrink-0 space-y-4 overflow-y-auto border-r border-zinc-800 bg-zinc-950/60 p-4 lg:static lg:block lg:h-full`}
          aria-label="问答范围与历史线程"
        >
          <ScopePicker
            projects={projects}
            projectsLoading={projectsLoading}
            selectedProjectId={selectedProjectId}
            onSelectProject={(projectId) => {
              setSelectedProjectId(projectId);
              setSelectedDocumentIds([]);
            }}
            mode={mode}
            onModeChange={(nextMode) => setMode(nextMode)}
            meetings={meetings}
            meetingsLoading={meetingsLoading}
            selectedDocumentIds={selectedDocumentIds}
            onToggleDocument={handleToggleDocument}
            onClearDocuments={() => setSelectedDocumentIds([])}
          />
          <ThreadList
            threads={threads}
            loading={threadsLoading}
            activeThreadId={threadId}
            onSelect={handleSelectThread}
            onNewThread={handleNewThread}
          />
        </aside>

        {/* 主区域 */}
        <section className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <header className="flex items-center gap-3 border-b border-zinc-800 px-4 py-3">
            <Button
              color="transparent"
              shape="rounded"
              className="px-2 py-1.5 text-xs lg:hidden"
              onClick={() => setPanelOpen((open) => !open)}
              aria-expanded={panelOpen}
            >
              <PanelLeft className="mr-1.5 h-3.5 w-3.5" />
              范围 / 线程
            </Button>
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold text-zinc-100">
                会议问答
              </h1>
              <p className="truncate text-xs text-zinc-400">
                本轮范围：{scopeSummary}
              </p>
            </div>
            {running && (
              <Button
                color="transparent"
                shape="rounded"
                className="ml-auto px-2 py-1.5 text-xs"
                onClick={agent.abort}
              >
                <Square className="mr-1.5 h-3 w-3" />
                停止
              </Button>
            )}
          </header>

          <div className="flex-1 overflow-y-auto px-4 py-4">
            {historyError && (
              <div className="mx-auto mb-4 w-full max-w-3xl">
                <ErrorNotice
                  error={historyError}
                  onRetry={() => {
                    void fetchHistory(threadId)
                      .then((history) => agent.restore(history))
                      .catch(() => undefined);
                  }}
                />
              </div>
            )}

            {historyLoading && agent.turns.length === 0 ? (
              <LoadingBlock label="正在恢复历史线程…" />
            ) : agent.turns.length === 0 ? (
              <EmptyBlock
                title="开始提问吧"
                description="先在左侧选择项目与范围，然后输入问题。回答会显示进度、结论和可点击的原文引用。"
              />
            ) : (
              <div className="mx-auto w-full max-w-3xl space-y-5">
                {agent.turns.map((turn) =>
                  turn.role === 'user' ? (
                    <div key={turn.id} className="flex justify-end">
                      <div className="max-w-[85%] rounded-lg bg-accent-base/15 px-3 py-2 text-sm text-zinc-100">
                        {turn.content}
                      </div>
                    </div>
                  ) : (
                    <div key={turn.id} className="space-y-3">
                      {turn.status === 'streaming' && (
                        <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
                          {agent.progress.length > 0 && (
                            <ul className="mb-2 space-y-1">
                              {agent.progress.map((step, index) => (
                                <li
                                  key={`${step}-${index}`}
                                  className="text-xs text-zinc-400"
                                >
                                  · {step}
                                </li>
                              ))}
                            </ul>
                          )}
                          {turn.content ? (
                            <div className="whitespace-pre-wrap break-words text-sm text-zinc-300">
                              {turn.content}
                            </div>
                          ) : (
                            <p className="text-xs text-zinc-500">正在思考…</p>
                          )}
                        </div>
                      )}

                      {turn.status !== 'streaming' && (
                        <AnswerPanel
                          answerRecord={turn.answerRecord}
                          status={turn.status}
                          draft={turn.content}
                          onOpenSource={handleOpenSource}
                        />
                      )}

                      {turn.error && <ErrorNotice error={turn.error} />}
                    </div>
                  )
                )}

                {agent.error && !agent.turns.length && (
                  <ErrorNotice error={agent.error} />
                )}
              </div>
            )}
          </div>

          <form
            onSubmit={handleSend}
            className="border-t border-zinc-800 px-4 py-3"
          >
            <div className="mx-auto w-full max-w-3xl">
              {inputError && (
                <p className="mb-2 text-xs text-amber-300">{inputError}</p>
              )}
              <div className="flex items-end gap-2">
                <Textarea
                  value={question}
                  rows={2}
                  placeholder="就所选范围的会议提问…"
                  onChange={(event) => {
                    setQuestion(event.target.value);
                    if (inputError) {
                      setInputError(null);
                    }
                  }}
                  onKeyDown={(event) => {
                    if (
                      event.key === 'Enter' &&
                      (event.metaKey || event.ctrlKey)
                    ) {
                      event.preventDefault();
                      void submitQuestion();
                    }
                  }}
                  className="min-h-[44px] flex-1"
                />
                <Button
                  type="submit"
                  color="filled"
                  shape="rounded"
                  className="px-4 py-2"
                  disabled={running}
                >
                  <Send className="mr-1.5 h-4 w-4" />
                  {running ? '生成中…' : '发送'}
                </Button>
              </div>
              <p className="mt-2 text-[11px] text-zinc-500">
                Ctrl/⌘ + Enter 发送。回答只依据所选范围，引用可点击查看原文。
              </p>
            </div>
          </form>
        </section>
      </main>

      <SourceDialog
        entry={sourceEntry}
        open={sourceOpen}
        onClose={() => setSourceOpen(false)}
      />
    </Layout>
  );
};

export default ChatPage;
