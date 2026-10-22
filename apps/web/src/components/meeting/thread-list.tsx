import { MessageSquarePlus } from 'lucide-react';
import React, { useMemo } from 'react';

import type { ThreadSummary } from '@/components/meeting/api';
import { EmptyBlock, LoadingBlock } from '@/components/meeting/empty-state';
import { Button } from '@/components/ui/Button';

export interface ThreadListProps {
  threads: ThreadSummary[];
  loading: boolean;
  activeThreadId: string | null;
  onSelect: (threadId: string) => void;
  onNewThread: () => void;
  /** thread_id → 项目名（取不到时显示「未标注项目」）。 */
  projectNames?: Record<string, string>;
}

function formatTime(value?: string | null): string {
  if (!value) {
    return '';
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return '';
  }
  return parsed.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function ThreadList({
  threads,
  loading,
  activeThreadId,
  onSelect,
  onNewThread,
  projectNames,
}: ThreadListProps): JSX.Element {
  // 标题重复时，用项目名与时间区分，避免看起来是同一条会话。
  const duplicatedTitles = useMemo(() => {
    const counter = new Map<string, number>();
    for (const thread of threads) {
      const key = (thread.title ?? '').trim();
      counter.set(key, (counter.get(key) ?? 0) + 1);
    }
    return new Set(
      [...counter.entries()]
        .filter(([, count]) => count > 1)
        .map(([title]) => title)
    );
  }, [threads]);

  return (
    <section
      className="space-y-3 rounded-md border border-zinc-800 bg-zinc-950/40 p-4"
      aria-label="历史会话"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-100">历史会话</h2>
        <Button
          color="transparent"
          shape="rounded"
          className="px-2 py-1 text-xs"
          onClick={onNewThread}
          aria-label="新建会话"
        >
          <MessageSquarePlus className="mr-1.5 h-3.5 w-3.5" />
          新建
        </Button>
      </div>

      {loading && threads.length === 0 ? (
        <LoadingBlock label="正在读取会话…" />
      ) : threads.length === 0 ? (
        <EmptyBlock
          title="还没有历史会话"
          description="提问后会话会自动保存在服务端，刷新页面后可以继续查看。"
        />
      ) : (
        <ul className="max-h-72 space-y-1 overflow-y-auto">
          {threads.map((thread) => {
            const active = thread.thread_id === activeThreadId;
            const time = formatTime(thread.updated_at ?? thread.created_at);
            const project = projectNames?.[thread.thread_id];
            const projectLabel = project ?? '未标注项目';
            const duplicated = duplicatedTitles.has(
              (thread.title ?? '').trim()
            );
            return (
              <li key={thread.thread_id}>
                <button
                  type="button"
                  onClick={() => onSelect(thread.thread_id)}
                  aria-current={active ? 'true' : undefined}
                  title={`${thread.title} · ${projectLabel}${
                    time ? ` · ${time}` : ''
                  }`}
                  className={`w-full rounded border-l-2 px-2 py-1.5 text-left text-xs transition-colors focus:outline-none focus:ring-2 focus:ring-accent-base ${
                    active
                      ? 'border-accent-base bg-accent-base/15 text-white'
                      : 'border-transparent text-zinc-300 hover:bg-zinc-800/60'
                  }`}
                >
                  <span className="block truncate font-medium">
                    {thread.title}
                  </span>
                  <span className="mt-0.5 flex items-center gap-1 text-[10px] text-zinc-500">
                    <span className="truncate">{projectLabel}</span>
                    {time && (
                      <>
                        <span aria-hidden>·</span>
                        <span className="shrink-0">{time}</span>
                      </>
                    )}
                    {duplicated && (
                      <span className="shrink-0 text-zinc-600">
                        （同名会话）
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export default ThreadList;
