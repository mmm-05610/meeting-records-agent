import { Badge } from '@/components/ui/badge';
import type { DocumentStatus, RecordKind } from '@/types/meeting-contracts';

export const MEETING_STATUS_LABELS: Record<DocumentStatus, string> = {
  ready: '已就绪',
  processing: '处理中',
  failed: '处理失败',
  unknown: '状态未知',
};

export const RECORD_KIND_LABELS: Record<RecordKind, string> = {
  transcript: '逐字稿',
  minutes: '会议纪要',
};

export const TIME_PRECISION_LABELS: Record<'date' | 'datetime', string> = {
  date: '仅日期',
  datetime: '日期与时间',
};

export function MeetingStatusBadge({
  status,
}: {
  status: DocumentStatus;
}): JSX.Element {
  const variant =
    status === 'ready'
      ? 'success'
      : status === 'failed'
        ? 'destructive'
        : status === 'processing'
          ? 'pending'
          : 'secondary';
  return <Badge variant={variant}>{MEETING_STATUS_LABELS[status]}</Badge>;
}

export function RecordKindBadge({ kind }: { kind: RecordKind }): JSX.Element {
  return <Badge variant="outline">{RECORD_KIND_LABELS[kind]}</Badge>;
}
