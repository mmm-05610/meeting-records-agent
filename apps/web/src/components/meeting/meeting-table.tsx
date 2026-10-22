import { RefreshCw, Trash2 } from 'lucide-react';
import React from 'react';

import type { MeetingApiError, MeetingSummary } from '@/components/meeting/api';
import { EmptyBlock, LoadingBlock } from '@/components/meeting/empty-state';
import { ErrorNotice } from '@/components/meeting/error-notice';
import {
  MeetingStatusBadge,
  RecordKindBadge,
} from '@/components/meeting/status-badge';
import { Button } from '@/components/ui/Button';

export interface MeetingTableProps {
  meetings: MeetingSummary[];
  loading: boolean;
  error: MeetingApiError | null;
  onRefresh: () => void;
  onDelete: (meeting: MeetingSummary) => void;
  emptyTitle?: string;
  emptyDescription?: string;
}

export function MeetingTable({
  meetings,
  loading,
  error,
  onRefresh,
  onDelete,
  emptyTitle = '该项目还没有会议记录',
  emptyDescription = '上传会议记录后，这里会显示标题、日期、类型、参与人和处理状态。',
}: MeetingTableProps): JSX.Element {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-100">
          会议列表
          {meetings.length > 0 && (
            <span className="ml-2 text-xs font-normal text-zinc-400">
              共 {meetings.length} 场
            </span>
          )}
        </h2>
        <Button
          color="transparent"
          shape="rounded"
          className="px-3 py-1.5 text-xs"
          onClick={onRefresh}
          disabled={loading}
        >
          <RefreshCw
            className={`mr-1.5 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`}
          />
          刷新状态
        </Button>
      </div>

      <ErrorNotice error={error} onRetry={onRefresh} />

      {loading && meetings.length === 0 ? (
        <LoadingBlock label="正在读取会议列表…" />
      ) : meetings.length === 0 ? (
        <EmptyBlock title={emptyTitle} description={emptyDescription} />
      ) : (
        <ul className="divide-y divide-zinc-800 overflow-hidden rounded-md border border-zinc-800 bg-zinc-950/30">
          {meetings.map((meeting) => (
            <li
              key={meeting.document_id}
              className="grid grid-cols-1 gap-2 p-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] sm:items-start"
            >
              <div className="min-w-0">
                <p
                  className="truncate text-sm font-medium text-zinc-100"
                  title={meeting.title}
                >
                  {meeting.title}
                </p>
                <p
                  className="mt-1 truncate text-xs text-zinc-400"
                  title={
                    meeting.participants.length > 0
                      ? meeting.participants.join('、')
                      : '参与人：未记录'
                  }
                >
                  {meeting.participants.length > 0
                    ? `参与人：${meeting.participants.join('、')}`
                    : '参与人：未记录'}
                </p>
                <details className="mt-1">
                  <summary className="cursor-pointer text-[11px] text-zinc-500 hover:text-zinc-300 focus:outline-none focus:ring-2 focus:ring-accent-base">
                    详情
                  </summary>
                  <p className="mt-1 break-all font-mono text-[11px] text-zinc-500">
                    文档 ID：{meeting.document_id}
                  </p>
                  <p className="mt-0.5 break-all font-mono text-[11px] text-zinc-500">
                    内容指纹：{meeting.content_sha256 || '—'}
                  </p>
                </details>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                <span className="inline-flex items-center gap-1">
                  会议日期：
                  {meeting.meeting_date || '未记录'}
                </span>
                <RecordKindBadge kind={meeting.record_kind} />
                <MeetingStatusBadge status={meeting.status} />
                <span>分块数：{meeting.chunk_count}</span>
              </div>

              <div className="flex justify-start sm:justify-end">
                <Button
                  color="transparent"
                  shape="rounded"
                  className="px-2 py-1 text-xs text-red-400 hover:bg-red-950/40"
                  onClick={() => onDelete(meeting)}
                  aria-label={`删除会议 ${meeting.title}`}
                >
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                  删除
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default MeetingTable;
