/**
 * 引用（C03/C04）到展示编号的映射。
 *
 * 身份只来自 `source_key -> {document_id, chunk_id, chunk_order}`：
 * 相同文字来自不同会议时，必须按 document_id / chunk_id 区分，
 * 绝不按引文文本匹配。
 */

import type { SourceRef } from '@/types/meeting-contracts';

export interface SourceEntry {
  /** `answer_record.sources` 中的稳定键 */
  key: string;
  source: SourceRef;
  /** 同一回答内的展示编号（从 1 开始） */
  number: number;
}

export function normalizeSourceRef(key: string, raw: unknown): SourceRef {
  const record = (raw ?? {}) as Partial<SourceRef>;
  return {
    source_key:
      typeof record.source_key === 'string' && record.source_key
        ? record.source_key
        : key,
    document_id:
      typeof record.document_id === 'string' ? record.document_id : '',
    chunk_id: typeof record.chunk_id === 'string' ? record.chunk_id : '',
    chunk_order:
      typeof record.chunk_order === 'number' &&
      Number.isFinite(record.chunk_order)
        ? record.chunk_order
        : 0,
    title: typeof record.title === 'string' ? record.title : null,
    meeting_date:
      typeof record.meeting_date === 'string' ? record.meeting_date : null,
    record_kind:
      record.record_kind === 'transcript' || record.record_kind === 'minutes'
        ? record.record_kind
        : null,
    quote: typeof record.quote === 'string' ? record.quote : '',
  };
}

/** 按 `sources` 的插入顺序生成展示编号。 */
export function buildSourceEntries(
  sources: Record<string, SourceRef> | null | undefined
): SourceEntry[] {
  if (!sources || typeof sources !== 'object') {
    return [];
  }
  return Object.entries(sources).map(([key, value], index) => ({
    key,
    source: normalizeSourceRef(key, value),
    number: index + 1,
  }));
}

/**
 * 解析答案正文中的引用标记。
 *
 * 优先级：
 *  1. 标记本身就是 source_key；
 *  2. 标记是展示编号（与 sources 插入顺序一致）；
 *  3. 标记形如 s1 / src_2（仅在唯一命中时）。
 */
export function resolveCitationMarker(
  marker: string,
  entries: SourceEntry[]
): SourceEntry | null {
  const trimmed = (marker ?? '').trim();
  if (!trimmed) {
    return null;
  }

  const exact = entries.find((entry) => entry.key === trimmed);
  if (exact) {
    return exact;
  }

  if (/^\d+$/.test(trimmed)) {
    const index = Number(trimmed) - 1;
    if (index >= 0 && index < entries.length) {
      return entries[index];
    }
  }

  const pattern = /^(?:src|source|s|来源)?[-_]?(\d+)$/i;
  const matched = pattern.exec(trimmed);
  if (matched) {
    const number = Number(matched[1]);
    const candidates = entries.filter((entry) => {
      const hit = pattern.exec(entry.key);
      return hit !== null && Number(hit[1]) === number;
    });
    if (candidates.length === 1) {
      return candidates[0];
    }
  }

  return null;
}

export interface TextPart {
  text: string;
  marker?: string;
  entry?: SourceEntry;
}

const MARKER_PATTERN = /\[([^\[\]]{1,80})\]/g;

/** 把答案正文切成普通文本与引用标记；未命中来源的标记保持纯文本。 */
export function splitCitations(
  text: string,
  entries: SourceEntry[]
): TextPart[] {
  const parts: TextPart[] = [];
  if (!text) {
    return parts;
  }
  let cursor = 0;
  for (const match of text.matchAll(MARKER_PATTERN)) {
    const index = match.index ?? 0;
    if (index > cursor) {
      parts.push({ text: text.slice(cursor, index) });
    }
    const marker = match[1];
    const entry = resolveCitationMarker(marker, entries);
    parts.push(entry ? { text: match[0], marker, entry } : { text: match[0] });
    cursor = index + match[0].length;
  }
  if (cursor < text.length) {
    parts.push({ text: text.slice(cursor) });
  }
  return parts;
}
