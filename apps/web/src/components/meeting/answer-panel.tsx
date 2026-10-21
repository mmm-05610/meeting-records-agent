import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import React, { useMemo } from 'react';

import { CitationText } from '@/components/meeting/citation-text';
import {
  buildSourceEntries,
  resolveCitationMarker,
  type SourceEntry,
} from '@/components/meeting/citations';
import { Badge } from '@/components/ui/badge';
import type { AnswerRecord, ClaimKind } from '@/types/meeting-contracts';

export const CLAIM_KIND_LABELS: Record<ClaimKind, string> = {
  fact: '事实',
  proposal: '提议',
  confirmed: '已确认',
  change: '变更',
  conflict: '冲突',
  unknown: '未知',
};

export interface AnswerPanelProps {
  answerRecord: AnswerRecord | null;
  /** 本轮状态：只有 completed 才允许展示为已完成答案 */
  status: string;
  draft?: string;
  onOpenSource: (entry: SourceEntry) => void;
}

export function AnswerPanel({
  answerRecord,
  status,
  draft,
  onOpenSource,
}: AnswerPanelProps): JSX.Element | null {
  const entries = useMemo(
    () => buildSourceEntries(answerRecord?.sources),
    [answerRecord?.sources]
  );

  const completed = answerRecord?.status === 'completed';

  if (!answerRecord && !draft) {
    return null;
  }

  if (!completed) {
    return (
      <div className="rounded-md border border-amber-700/60 bg-amber-950/20 p-3">
        <div className="flex items-center gap-2 text-sm text-amber-200">
          {status === 'streaming' || status === 'running' ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <AlertTriangle className="h-4 w-4" />
          )}
          <span className="font-medium">
            {status === 'streaming' || status === 'running'
              ? '正在生成…'
              : '本轮未完成，不作为最终答案展示'}
          </span>
        </div>
        {draft ? (
          <div className="mt-2 whitespace-pre-wrap break-words text-sm text-zinc-300">
            {draft}
          </div>
        ) : (
          <p className="mt-2 text-xs text-zinc-400">
            服务端没有返回可用答案，请查看错误提示或重试。
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-md border border-zinc-800 bg-zinc-950/40 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
        <span className="text-sm font-medium text-zinc-100">最终答案</span>
        <Badge variant="success">已完成</Badge>
        {answerRecord?.scope_snapshot?.mode && (
          <span className="text-xs text-zinc-400">
            范围：
            {answerRecord.scope_snapshot.mode === 'all_ready'
              ? '项目内全部已就绪会议'
              : `指定 ${answerRecord.scope_snapshot.documents?.length ?? 0} 场会议`}
          </span>
        )}
      </div>

      {answerRecord?.text && (
        <CitationText
          text={answerRecord.text}
          entries={entries}
          onOpenSource={onOpenSource}
        />
      )}

      {entries.length > 0 && (
        <section>
          <h3 className="mb-2 text-xs font-medium text-zinc-400">
            来源（{entries.length}）
          </h3>
          <ul className="space-y-1">
            {entries.map((entry) => (
              <li key={entry.key}>
                <button
                  type="button"
                  onClick={() => onOpenSource(entry)}
                  className="flex w-full items-start gap-2 rounded px-2 py-1 text-left text-xs text-zinc-300 hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-accent-base"
                >
                  <span className="mt-0.5 rounded bg-accent-base/15 px-1 font-semibold text-accent-base">
                    {entry.number}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">
                      {entry.source.title ?? '未命名会议'}
                    </span>
                    <span className="block truncate text-zinc-500">
                      {entry.source.meeting_date ?? '日期未记录'} · 片段{' '}
                      {entry.source.chunk_order} · 文档{' '}
                      {entry.source.document_id}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {answerRecord?.claims && answerRecord.claims.length > 0 && (
        <section>
          <h3 className="mb-2 text-xs font-medium text-zinc-400">结论条目</h3>
          <ul className="space-y-2">
            {answerRecord.claims.map((claim, index) => (
              <li
                key={`${claim.text}-${index}`}
                className="rounded border border-zinc-800 bg-zinc-950/60 p-2"
              >
                <div className="mb-1 flex items-center gap-2">
                  <Badge variant="secondary">
                    {CLAIM_KIND_LABELS[claim.kind] ?? claim.kind}
                  </Badge>
                  {claim.evidence_ids.map((evidenceId) => {
                    const entry = resolveCitationMarker(evidenceId, entries);
                    if (!entry) {
                      return (
                        <span
                          key={evidenceId}
                          className="font-mono text-[10px] text-zinc-500"
                        >
                          {evidenceId}
                        </span>
                      );
                    }
                    return (
                      <button
                        key={evidenceId}
                        type="button"
                        onClick={() => onOpenSource(entry)}
                        className="rounded bg-accent-base/15 px-1 text-[10px] font-semibold text-accent-base hover:bg-accent-base/25 focus:outline-none focus:ring-2 focus:ring-accent-base"
                      >
                        [{entry.number}]
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-zinc-200">{claim.text}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {answerRecord?.coverage && (
        <section className="text-xs text-zinc-400">
          <h3 className="mb-1 font-medium text-zinc-400">覆盖情况</h3>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <span>已核对：{answerRecord.coverage.checked?.length ?? 0}</span>
            <span>未核对：{answerRecord.coverage.unchecked?.length ?? 0}</span>
            <span>失败：{answerRecord.coverage.failed?.length ?? 0}</span>
            {answerRecord.coverage.budget_exhausted && (
              <span className="text-amber-300">阅读预算已用尽</span>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

export default AnswerPanel;
