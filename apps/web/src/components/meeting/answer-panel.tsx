import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  HelpCircle,
  Info,
  Loader2,
} from 'lucide-react';
import React, { useMemo, useState } from 'react';

import { CitationText } from '@/components/meeting/citation-text';
import {
  buildSourceEntries,
  resolveCitationMarker,
  type SourceEntry,
} from '@/components/meeting/citations';
import { Badge } from '@/components/ui/badge';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
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
  /** 服务端要求澄清时，本轮不是最终答案，但不属于失败。 */
  clarification?: boolean;
  /** 服务端进度步骤，用于判断本轮走的是事实检索还是完整核对。 */
  progress?: string[];
  onOpenSource: (entry: SourceEntry) => void;
  /** 重新提问本轮问题（失败 / 中断后使用）。 */
  onRetry?: () => void;
}

interface CoverageSummary {
  checked: number;
  unchecked: number;
  failed: number;
  total: number;
  budgetExhausted: boolean;
  empty: boolean;
}

function summarizeCoverage(record: AnswerRecord | null): CoverageSummary {
  const coverage = record?.coverage;
  const checked = coverage?.checked?.length ?? 0;
  const unchecked = coverage?.unchecked?.length ?? 0;
  const failed = coverage?.failed?.length ?? 0;
  const snapshotTotal = record?.scope_snapshot?.documents?.length ?? 0;
  const total = Math.max(snapshotTotal, checked + unchecked + failed);
  const budgetExhausted = coverage?.budget_exhausted === true;
  return {
    checked,
    unchecked,
    failed,
    total,
    budgetExhausted,
    empty: checked === 0 && unchecked === 0 && failed === 0 && !budgetExhausted,
  };
}

/** 完整核对：服务端逐场读过会议，覆盖情况非空。 */
function isFullVerification(
  record: AnswerRecord | null,
  progress: string[] | undefined
): boolean {
  if (progress?.some((step) => step.includes('决定/变更核对'))) {
    return true;
  }
  return !summarizeCoverage(record).empty;
}

function SectionToggle({
  label,
  count,
  open,
  onOpenChange,
  id,
  children,
}: {
  label: string;
  count?: number;
  open: boolean;
  onOpenChange: (next: boolean) => void;
  id: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <CollapsibleTrigger
        id={id}
        className="flex items-center gap-1.5 rounded-md border border-zinc-800 px-2.5 py-1.5 text-xs text-zinc-300 transition-colors hover:bg-zinc-800/70 hover:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-accent-base"
      >
        <ChevronDown
          className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden
        />
        {label}
        {typeof count === 'number' && (
          <span className="text-zinc-500">（{count}）</span>
        )}
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-3 space-y-3">
        <div className="h-px bg-zinc-800" aria-hidden />
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

export function AnswerPanel({
  answerRecord,
  status,
  draft,
  clarification,
  progress,
  onOpenSource,
  onRetry,
}: AnswerPanelProps): JSX.Element | null {
  const entries = useMemo(
    () => buildSourceEntries(answerRecord?.sources),
    [answerRecord?.sources]
  );
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [diagnosticOpen, setDiagnosticOpen] = useState(false);

  const completed = answerRecord?.status === 'completed';
  const coverage = summarizeCoverage(answerRecord);
  const fullVerification = isFullVerification(answerRecord, progress);

  if (!answerRecord && !draft) {
    return null;
  }

  if (clarification && !answerRecord) {
    return (
      <div
        className="rounded-md border border-sky-800/60 bg-sky-950/20 p-3"
        role="status"
      >
        <div className="flex flex-wrap items-center gap-2 text-sm text-sky-200">
          <HelpCircle className="h-4 w-4" aria-hidden />
          <span className="font-medium">需要澄清</span>
          <span className="text-xs text-sky-300/80">
            回答前需要先确认指代对象，这不是最终答案，也不算失败
          </span>
        </div>
        <div className="mt-2 whitespace-pre-wrap break-words text-sm text-zinc-200">
          {draft}
        </div>
      </div>
    );
  }

  if (!completed) {
    const running = status === 'streaming' || status === 'running';
    const cancelled = status === 'interrupted';
    return (
      <div
        className={`rounded-md border p-3 ${
          running
            ? 'border-zinc-800 bg-zinc-950/40'
            : cancelled
              ? 'border-zinc-700 bg-zinc-950/40'
              : 'border-amber-700/60 bg-amber-950/20'
        }`}
        role="status"
      >
        <div
          className={`flex flex-wrap items-center gap-2 text-sm ${
            running
              ? 'text-zinc-200'
              : cancelled
                ? 'text-zinc-300'
                : 'text-amber-200'
          }`}
        >
          {running ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <AlertTriangle className="h-4 w-4" aria-hidden />
          )}
          <span className="font-medium">
            {running
              ? '正在生成…'
              : cancelled
                ? '本轮已取消'
                : '本轮未完成，不作为最终答案展示'}
          </span>
          {cancelled && (
            <span className="text-xs text-zinc-400">
              已停止生成，可以重新提问
            </span>
          )}
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
        {onRetry && !running && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-3 rounded-md border border-zinc-700 px-3 py-1 text-xs text-zinc-200 hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-accent-base"
          >
            重新提问
          </button>
        )}
      </div>
    );
  }

  const statusLabel = fullVerification
    ? `完整会议核对 · 已完成 · 覆盖 ${coverage.checked}/${coverage.total} 场`
    : '事实检索 · 已完成';

  const scopeLine = answerRecord?.scope_snapshot?.mode
    ? answerRecord.scope_snapshot.mode === 'all_ready'
      ? '范围：项目内全部已就绪会议'
      : `范围：指定 ${answerRecord.scope_snapshot.documents?.length ?? 0} 场会议`
    : '';

  const hasClaims = Boolean(answerRecord?.claims && answerRecord.claims.length);
  const hasCoverage = !coverage.empty;

  return (
    <div className="space-y-4 rounded-md border border-zinc-800 bg-zinc-950/40 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <CheckCircle2 className="h-4 w-4 text-emerald-500" aria-hidden />
        <span className="text-sm font-medium text-zinc-100">{statusLabel}</span>
        {fullVerification && coverage.total > 0 && (
          <Badge variant="secondary">逐场核对</Badge>
        )}
        {scopeLine && (
          <span className="text-xs text-zinc-400">{scopeLine}</span>
        )}
      </div>

      {fullVerification && (coverage.unchecked > 0 || coverage.failed > 0) && (
        <p className="rounded-md border border-amber-700/60 bg-amber-950/20 p-2 text-xs text-amber-200">
          覆盖不足：{coverage.unchecked} 场未核对
          {coverage.failed > 0 ? `，${coverage.failed} 场读取失败` : ''}
          。以上结论只覆盖已核对的部分。
        </p>
      )}

      {answerRecord?.text && (
        <CitationText
          text={answerRecord.text}
          entries={entries}
          onOpenSource={onOpenSource}
        />
      )}

      <div className="flex flex-wrap gap-2">
        {entries.length > 0 && (
          <SectionToggle
            id="answer-sources-toggle"
            label="查看来源"
            count={entries.length}
            open={sourcesOpen}
            onOpenChange={setSourcesOpen}
          >
            <ul className="space-y-1">
              {entries.map((entry) => (
                <li key={entry.key}>
                  <SourceRow entry={entry} onOpenSource={onOpenSource} />
                </li>
              ))}
            </ul>
          </SectionToggle>
        )}

        {(hasClaims || hasCoverage || entries.length > 0) && (
          <SectionToggle
            id="answer-detail-toggle"
            label="查看核对详情"
            open={detailOpen}
            onOpenChange={setDetailOpen}
          >
            {hasClaims && (
              <section>
                <h4 className="mb-2 text-xs font-medium text-zinc-400">
                  结论条目
                </h4>
                <ul className="space-y-2">
                  {answerRecord?.claims?.map((claim, index) => (
                    <li
                      key={`${claim.text}-${index}`}
                      className="rounded border border-zinc-800 bg-zinc-950/60 p-2"
                    >
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <Badge variant="secondary">
                          {CLAIM_KIND_LABELS[claim.kind] ?? claim.kind}
                        </Badge>
                        {claim.evidence_ids.map((evidenceId) => {
                          const entry = resolveCitationMarker(
                            evidenceId,
                            entries
                          );
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
                              title={`打开来源 ${entry.number}`}
                              aria-label={`打开来源 ${entry.number}`}
                              className="rounded bg-accent-base/15 px-1 text-[10px] font-semibold text-accent-base hover:bg-accent-base/25 focus:outline-none focus:ring-2 focus:ring-accent-base"
                            >
                              [{entry.number}]
                            </button>
                          );
                        })}
                      </div>
                      <p className="break-words text-xs text-zinc-200">
                        {claim.text}
                      </p>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {hasCoverage && (
              <section className="text-xs text-zinc-400">
                <h4 className="mb-1 font-medium text-zinc-400">覆盖情况</h4>
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  <span>已核对：{coverage.checked} 场</span>
                  <span>未核对：{coverage.unchecked} 场</span>
                  <span>失败：{coverage.failed} 场</span>
                  {coverage.budgetExhausted && (
                    <span className="text-amber-300">阅读预算已用尽</span>
                  )}
                </div>
              </section>
            )}

            {!hasClaims && !hasCoverage && (
              <p className="text-xs text-zinc-500">
                本轮是事实检索，没有逐场核对条目与覆盖统计。
              </p>
            )}

            <section>
              <Collapsible
                open={diagnosticOpen}
                onOpenChange={setDiagnosticOpen}
              >
                <CollapsibleTrigger className="flex items-center gap-1.5 rounded-md border border-zinc-800 px-2.5 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800/70 hover:text-zinc-200 focus:outline-none focus:ring-2 focus:ring-accent-base">
                  <Info className="h-3.5 w-3.5" aria-hidden />
                  诊断信息
                  <ChevronDown
                    className={`h-3.5 w-3.5 transition-transform ${
                      diagnosticOpen ? 'rotate-180' : ''
                    }`}
                    aria-hidden
                  />
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-2 space-y-2">
                  <dl className="grid grid-cols-1 gap-1 rounded-md border border-zinc-800 bg-zinc-950/60 p-2 text-[11px] text-zinc-400 sm:grid-cols-2">
                    <div className="truncate">
                      <dt className="inline text-zinc-500">回答 ID：</dt>
                      <dd className="inline font-mono">
                        {answerRecord?.message_id || '—'}
                      </dd>
                    </div>
                    <div className="truncate">
                      <dt className="inline text-zinc-500">运行 ID：</dt>
                      <dd className="inline font-mono">
                        {answerRecord?.run_id || '—'}
                      </dd>
                    </div>
                    <div className="truncate">
                      <dt className="inline text-zinc-500">生成时间：</dt>
                      <dd className="inline">
                        {answerRecord?.created_at || '—'}
                      </dd>
                    </div>
                    <div className="truncate">
                      <dt className="inline text-zinc-500">模型配置：</dt>
                      <dd className="inline font-mono">
                        {answerRecord?.model_config_id || '—'}
                      </dd>
                    </div>
                    <div className="truncate sm:col-span-2">
                      <dt className="inline text-zinc-500">范围指纹：</dt>
                      <dd className="inline font-mono break-all">
                        {answerRecord?.scope_snapshot?.fingerprint || '—'}
                      </dd>
                    </div>
                  </dl>
                  <ul className="space-y-1">
                    {entries.map((entry) => (
                      <li
                        key={`diag-${entry.key}`}
                        className="rounded border border-zinc-800 bg-zinc-950/60 p-2 text-[11px] text-zinc-500"
                      >
                        <p className="truncate font-mono">
                          [{entry.number}] {entry.key}
                        </p>
                        <p className="mt-0.5 truncate font-mono">
                          文档 {entry.source.document_id || '—'} · 片段{' '}
                          {entry.source.chunk_id || '—'} · 序号{' '}
                          {entry.source.chunk_order}
                        </p>
                      </li>
                    ))}
                  </ul>
                </CollapsibleContent>
              </Collapsible>
            </section>
          </SectionToggle>
        )}
      </div>
    </div>
  );
}

function SourceRow({
  entry,
  onOpenSource,
}: {
  entry: SourceEntry;
  onOpenSource: (entry: SourceEntry) => void;
}): JSX.Element {
  const [detailOpen, setDetailOpen] = useState(false);
  const title = entry.source.title ?? '未命名会议';
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950/50">
      <button
        type="button"
        onClick={() => onOpenSource(entry)}
        title={`打开来源 ${entry.number}：${title}`}
        aria-label={`打开来源 ${entry.number}：${title}`}
        className="flex w-full items-start gap-2 px-2 py-1.5 text-left text-xs text-zinc-300 hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-accent-base"
      >
        <span className="mt-0.5 shrink-0 rounded bg-accent-base/15 px-1 font-semibold text-accent-base">
          {entry.number}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate">{title}</span>
          <span className="block truncate text-zinc-500">
            {entry.source.meeting_date ?? '日期未记录'}
          </span>
        </span>
      </button>
      <div className="px-2 pb-1.5">
        <button
          type="button"
          onClick={() => setDetailOpen((open) => !open)}
          aria-expanded={detailOpen}
          className="text-[10px] text-zinc-500 underline underline-offset-2 hover:text-zinc-300 focus:outline-none focus:ring-2 focus:ring-accent-base"
        >
          {detailOpen ? '收起详情' : '详情'}
        </button>
        {detailOpen && (
          <p className="mt-1 break-all font-mono text-[10px] text-zinc-500">
            来源键 {entry.source.source_key || entry.key} · 文档{' '}
            {entry.source.document_id || '—'} · 片段{' '}
            {entry.source.chunk_id || '—'} · 序号 {entry.source.chunk_order}
          </p>
        )}
      </div>
    </div>
  );
}

export default AnswerPanel;
