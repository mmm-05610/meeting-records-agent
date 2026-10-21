import React, { useMemo } from 'react';

import {
  splitCitations,
  type SourceEntry,
} from '@/components/meeting/citations';

export interface CitationTextProps {
  text: string;
  entries: SourceEntry[];
  onOpenSource: (entry: SourceEntry) => void;
  className?: string;
}

/**
 * 渲染答案正文：模型返回的内容一律按纯文本渲染（不解析 HTML），
 * 只有能解析到来源的 `[n]` 标记才变成可点击的引用。
 */
export function CitationText({
  text,
  entries,
  onOpenSource,
  className,
}: CitationTextProps): JSX.Element {
  const parts = useMemo(
    () => splitCitations(text ?? '', entries),
    [text, entries]
  );

  return (
    <div
      className={`whitespace-pre-wrap break-words text-sm leading-6 ${className ?? ''}`}
    >
      {parts.map((part, index) =>
        part.entry ? (
          <button
            key={`citation-${index}`}
            type="button"
            onClick={() => onOpenSource(part.entry as SourceEntry)}
            title={`打开来源 ${part.entry.number}：${part.entry.source.title ?? '未命名会议'}`}
            aria-label={`打开来源 ${part.entry.number}`}
            className="mx-0.5 rounded bg-accent-base/15 px-1 text-xs font-semibold text-accent-base underline underline-offset-2 hover:bg-accent-base/25 focus:outline-none focus:ring-2 focus:ring-accent-base"
          >
            {part.text}
          </button>
        ) : (
          <span key={`text-${index}`}>{part.text}</span>
        )
      )}
    </div>
  );
}

export default CitationText;
