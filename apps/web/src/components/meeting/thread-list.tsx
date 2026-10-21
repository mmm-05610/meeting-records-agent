import { MessageSquarePlus } from 'lucide-react';
import React from 'react';

import type { ThreadSummary } from '@/components/meeting/api';
import { EmptyBlock, LoadingBlock } from '@/components/meeting/empty-state';
import { Button } from '@/components/ui/Button';

export interface ThreadListProps {
  threads: ThreadSummary[];
  loading: boolean;
  activeThreadId: string | null;
  onSelect: (threadId: string) => void;
  onNewThread: () => void;
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
}: ThreadListProps): JSX.Element {
  return (
    <section className="space-y-3 rounded-md border border-zinc-800 bg-zinc-950/40 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-100">历史线程</h2>
        <Button
          color="transparent"
          shape="rounded"
          className="px-2 py-1 text-xs"
          onClick={onNewThread}
        >
          <MessageSquarePlus className="mr-1.5 h-3.5 w-3.5" />
          新建
        </Button>
      </div>

      {loading && threads.length === 0 ? (
        <LoadingBlock label="正在读取线程…" />
      ) : threads.length === 0 ? (
        <EmptyBlock
          title="还没有历史线程"
          description="提问后线程会自动保存在服务端，刷新页面后可以继续查看。"
        />
      ) : (
        <ul className="max-h-72 space-y-1 overflow-y-auto">
          {threads.map((thread) => {
            const active = thread.thread_id === activeThreadId;
            return (
              <li key={thread.thread_id}>
                <button
                  type="button"
                  onClick={() => onSelect(thread.thread_id)}
                  aria-current={active ? 'true' : undefined}
                  className={`w-full rounded px-2 py-1.5 text-left text-xs transition-colors focus:outline-none focus:ring-2 focus:ring-accent-base ${
                    active
                      ? 'bg-zinc-800 text-zinc-100'
                      : 'text-zinc-300 hover:bg-zinc-800/60'
                  }`}
                >
                  <span className="block truncate">{thread.title}</span>
                  {formatTime(thread.updated_at ?? thread.created_at) && (
                    <span className="block text-[10px] text-zinc-500">
                      {formatTime(thread.updated_at ?? thread.created_at)}
                    </span>
                  )}
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
