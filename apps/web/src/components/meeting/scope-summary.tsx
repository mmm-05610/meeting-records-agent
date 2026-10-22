import { Target } from 'lucide-react';
import React from 'react';

import type { MeetingSummary, ProjectSummary } from '@/components/meeting/api';
import type { ScopeMode, ScopeSnapshot } from '@/types/meeting-contracts';

export interface ScopeSummaryProps {
  /** 全部项目，用于把 collection_id 解析成项目名。 */
  projects: ProjectSummary[];
  /** 当前选择的范围。 */
  projectId: string;
  mode: ScopeMode;
  selectedDocumentIds: string[];
  meetings: MeetingSummary[];
  /** 服务端确认的范围快照；给出时表示「本轮实际使用范围」。 */
  snapshot?: ScopeSnapshot | null;
  /** 展示的标题。 */
  label?: string;
  className?: string;
}

export interface ScopeSummaryValue {
  projectName: string;
  mode: ScopeMode;
  count: number;
  text: string;
}

/** 计算范围文案：项目名 + 全部 / 指定 N 场。 */
export function resolveScopeSummary({
  projects,
  projectId,
  mode,
  selectedDocumentIds,
  meetings,
  snapshot,
}: Omit<ScopeSummaryProps, 'label' | 'className'>): ScopeSummaryValue {
  const collectionId = snapshot?.collection_id || projectId;
  const projectName =
    projects.find((project) => project.id === collectionId)?.name ??
    (collectionId ? '未标注项目' : '未选择项目');

  if (snapshot) {
    const count = snapshot.documents?.length ?? 0;
    return {
      projectName,
      mode: snapshot.mode,
      count,
      text:
        snapshot.mode === 'all_ready'
          ? `${projectName} · 全部已就绪会议（${count} 场）`
          : `${projectName} · 指定 ${count} 场会议`,
    };
  }

  if (mode === 'all_ready') {
    const ready = meetings.filter((item) => item.status === 'ready').length;
    return {
      projectName,
      mode,
      count: ready,
      text: `${projectName} · 全部已就绪会议（${ready} 场）`,
    };
  }

  return {
    projectName,
    mode,
    count: selectedDocumentIds.length,
    text: `${projectName} · 指定 ${selectedDocumentIds.length} 场会议`,
  };
}

export function ScopeSummary({
  projects,
  projectId,
  mode,
  selectedDocumentIds,
  meetings,
  snapshot,
  label = '本轮实际使用范围',
  className,
}: ScopeSummaryProps): JSX.Element {
  const summary = resolveScopeSummary({
    projects,
    projectId,
    mode,
    selectedDocumentIds,
    meetings,
    snapshot,
  });

  return (
    <p
      className={`flex min-w-0 items-center gap-1.5 text-xs text-zinc-400 ${className ?? ''}`}
      title={`${label}：${summary.text}`}
    >
      <Target className="h-3.5 w-3.5 shrink-0 text-accent-base" aria-hidden />
      <span className="shrink-0 text-zinc-500">{label}：</span>
      <span className="truncate text-zinc-200">{summary.text}</span>
    </p>
  );
}

export default ScopeSummary;
