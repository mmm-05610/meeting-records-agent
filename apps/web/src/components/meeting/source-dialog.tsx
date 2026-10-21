import { AlertTriangle, ExternalLink, Loader2 } from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';

import {
  MeetingApiError,
  fetchChunkNeighbors,
  fetchChunks,
  type ChunkItem,
} from '@/components/meeting/api';
import type { SourceEntry } from '@/components/meeting/citations';
import { RECORD_KIND_LABELS } from '@/components/meeting/status-badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export interface SourceDialogProps {
  entry: SourceEntry | null;
  open: boolean;
  onClose: () => void;
}

type LocateState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; chunk: ChunkItem; orderChanged: boolean }
  | { status: 'missing'; reason: string }
  | { status: 'error'; message: string };

/**
 * 定位来源片段：按 chunk_order 找到片段并核对 chunk_id；
 * 片段已随会议删除时显示“引用失效”。
 */
export function SourceDialog({
  entry,
  open,
  onClose,
}: SourceDialogProps): JSX.Element {
  const [state, setState] = useState<LocateState>({ status: 'idle' });
  const [neighbors, setNeighbors] = useState<ChunkItem[]>([]);

  const loadNeighbors = useCallback(
    async (documentId: string, chunkId: string) => {
      try {
        const items = await fetchChunkNeighbors(documentId, chunkId, 1);
        setNeighbors(items);
      } catch {
        setNeighbors([]);
      }
    },
    []
  );

  const locate = useCallback(
    async (target: SourceEntry) => {
      const documentId = target.source.document_id;
      const chunkId = target.source.chunk_id;
      const chunkOrder = target.source.chunk_order;

      if (!documentId || !chunkId) {
        setState({
          status: 'missing',
          reason: '来源缺少文档或片段标识，无法定位。',
        });
        return;
      }

      try {
        const first = await fetchChunks(documentId, 0, 50);
        const pageSize = first.page_size > 0 ? first.page_size : 50;
        const totalPages = Math.max(1, Math.ceil(first.total / pageSize));

        const pages: ChunkItem[][] = [first.items];
        const loadPage = async (page: number): Promise<ChunkItem[]> => {
          if (pages[page]) {
            return pages[page];
          }
          const result = await fetchChunks(documentId, page, pageSize);
          pages[page] = result.items;
          return result.items;
        };

        const guessPage = Math.min(
          totalPages - 1,
          Math.max(0, Math.floor(chunkOrder / pageSize))
        );
        const guessItems =
          guessPage === 0 ? first.items : await loadPage(guessPage);
        const byOrder = guessItems.find(
          (item) => item.chunk_order === chunkOrder
        );

        if (byOrder && byOrder.chunk_id === chunkId) {
          setState({ status: 'ready', chunk: byOrder, orderChanged: false });
          void loadNeighbors(documentId, chunkId);
          return;
        }

        // 顺序可能已被重排：按 chunk_id 在全部分页中核对。
        for (let page = 0; page < totalPages; page += 1) {
          const items = page === 0 ? first.items : await loadPage(page);
          const byId = items.find((item) => item.chunk_id === chunkId);
          if (byId) {
            setState({ status: 'ready', chunk: byId, orderChanged: true });
            void loadNeighbors(documentId, chunkId);
            return;
          }
        }

        setState({
          status: 'missing',
          reason: '该引用对应的原文片段已不存在（会议可能已被删除或重建）。',
        });
        setNeighbors([]);
      } catch (error) {
        const apiError =
          error instanceof MeetingApiError
            ? error
            : new MeetingApiError({
                category: 'service_failure',
                message: '无法读取原文片段，请稍后重试。',
                retryable: true,
              });
        if (apiError.status === 404) {
          setState({
            status: 'missing',
            reason: '引用失效：来源会议已被删除，原文不可访问。',
          });
          setNeighbors([]);
          return;
        }
        setState({ status: 'error', message: apiError.message });
      }
    },
    [loadNeighbors]
  );

  useEffect(() => {
    if (!open || !entry) {
      setState({ status: 'idle' });
      setNeighbors([]);
      return;
    }
    setState({ status: 'loading' });
    setNeighbors([]);
    void locate(entry);
  }, [entry, locate, open]);

  const source = entry?.source;
  const chunk = state.status === 'ready' ? state.chunk : undefined;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (!next ? onClose() : undefined)}
    >
      <DialogContent className="max-h-[85vh] w-[95vw] max-w-2xl overflow-y-auto bg-zinc-900 text-zinc-100">
        <DialogHeader>
          <DialogTitle className="text-base">
            来源{source ? ` ${entry?.number}` : ''}
            {source?.title ? ` · ${source.title}` : ''}
          </DialogTitle>
          <DialogDescription className="text-xs text-zinc-400">
            {source
              ? `会议日期：${source.meeting_date ?? '未记录'} · 记录类型：${
                  source.record_kind
                    ? RECORD_KIND_LABELS[source.record_kind]
                    : '未记录'
                } · 片段序号：${source.chunk_order}`
              : '来源信息缺失'}
          </DialogDescription>
        </DialogHeader>

        {source && (
          <dl className="grid grid-cols-1 gap-1 rounded-md border border-zinc-800 bg-zinc-950/50 p-3 text-xs text-zinc-400 sm:grid-cols-2">
            <div className="truncate">
              <dt className="inline text-zinc-500">文档 ID：</dt>
              <dd className="inline font-mono">{source.document_id || '—'}</dd>
            </div>
            <div className="truncate">
              <dt className="inline text-zinc-500">片段 ID：</dt>
              <dd className="inline font-mono">{source.chunk_id || '—'}</dd>
            </div>
            <div className="truncate">
              <dt className="inline text-zinc-500">来源键：</dt>
              <dd className="inline font-mono">
                {source.source_key || entry?.key}
              </dd>
            </div>
          </dl>
        )}

        {state.status === 'loading' && (
          <div className="flex items-center gap-2 py-6 text-sm text-zinc-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            正在定位原文片段…
          </div>
        )}

        {state.status === 'missing' && (
          <div className="flex items-start gap-2 rounded-md border border-amber-600/60 bg-amber-950/30 p-3 text-sm text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-medium">引用失效</p>
              <p className="mt-1 text-xs text-amber-200/80">{state.reason}</p>
            </div>
          </div>
        )}

        {state.status === 'error' && (
          <div className="rounded-md border border-red-600/60 bg-red-950/30 p-3 text-sm text-red-200">
            {state.message}
          </div>
        )}

        {state.status === 'ready' && chunk && (
          <div className="space-y-3">
            {state.orderChanged && (
              <p className="rounded-md border border-amber-600/60 bg-amber-950/30 p-2 text-xs text-amber-200">
                片段顺序在导入后发生了变化，这里按片段 ID 精确定位。
              </p>
            )}

            <section>
              <h3 className="mb-1 text-xs font-medium text-zinc-400">
                引用原文
              </h3>
              <blockquote className="rounded-md border-l-2 border-accent-base bg-zinc-950/60 p-3 text-sm text-zinc-200">
                {source?.quote?.trim() ? source.quote : '（回答未附带引文）'}
              </blockquote>
            </section>

            <section>
              <h3 className="mb-1 text-xs font-medium text-zinc-400">
                原文片段（序号 {chunk.chunk_order}）
              </h3>
              <div className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-md border border-zinc-800 bg-zinc-950/60 p-3 text-sm text-zinc-200">
                {chunk.text || '（该片段没有文本）'}
              </div>
            </section>

            <section>
              <h3 className="mb-1 text-xs font-medium text-zinc-400">
                相邻片段
              </h3>
              {neighbors.length === 0 ? (
                <p className="text-xs text-zinc-500">没有可显示的相邻片段。</p>
              ) : (
                <ul className="space-y-2">
                  {neighbors
                    .filter((item) => item.chunk_id !== chunk.chunk_id)
                    .map((item) => (
                      <li
                        key={item.chunk_id}
                        className="rounded-md border border-zinc-800 bg-zinc-950/40 p-2"
                      >
                        <p className="mb-1 text-xs text-zinc-500">
                          序号 {item.chunk_order}
                          {item.chunk_order < chunk.chunk_order
                            ? '（前一块）'
                            : '（后一块）'}
                        </p>
                        <p className="max-h-32 overflow-y-auto whitespace-pre-wrap text-xs text-zinc-300">
                          {item.text}
                        </p>
                      </li>
                    ))}
                </ul>
              )}
            </section>
          </div>
        )}

        <div className="flex justify-end">
          <ExternalLink className="mr-2 h-4 w-4 text-zinc-500" aria-hidden />
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-accent-base"
          >
            关闭（Esc）
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default SourceDialog;
