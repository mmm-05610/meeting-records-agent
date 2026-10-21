/**
 * 会议分块读取与相邻片段（C03 / C07）。
 */

import { ApiError, inputError } from './errors';
import type { ChunkItem, ChunksPage } from './meeting';
import { r2rListChunks } from './r2r';

function chunkOrder(
  chunk: { metadata?: Record<string, unknown> | null },
  fallback: number
): number {
  const value = chunk.metadata?.chunk_order;
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** 读取一页分块。 */
export async function readChunksPage(
  token: string,
  documentId: string,
  page: number,
  pageSize: number
): Promise<ChunksPage> {
  const offset = page * pageSize;
  const { chunks, total } = await r2rListChunks(token, documentId, {
    offset,
    limit: pageSize,
  });
  const items: ChunkItem[] = chunks.map((chunk, index) => ({
    chunk_id: chunk.id,
    chunk_order: chunkOrder(chunk, offset + index),
    text: chunk.text ?? '',
  }));
  return { page, page_size: pageSize, total, items };
}

/** 读取命中片段的相邻原文（保持各自身份，不按文本匹配）。 */
export async function readNeighbors(
  token: string,
  documentId: string,
  chunkId: string,
  radius: number
): Promise<ChunkItem[]> {
  const { chunks } = await r2rListChunks(token, documentId, {
    offset: 0,
    limit: 1000,
  });
  const indexed = chunks.map((chunk, index) => ({
    chunk_id: chunk.id,
    chunk_order: chunkOrder(chunk, index),
    text: chunk.text ?? '',
  }));
  const target = indexed.find((item) => item.chunk_id === chunkId);
  if (!target) {
    throw new ApiError(
      404,
      'invalid_citation',
      '引用片段不存在或已被移除。',
      ['chunk_id'],
      false
    );
  }
  const from = target.chunk_order - radius;
  const to = target.chunk_order + radius;
  return indexed
    .filter((item) => item.chunk_order >= from && item.chunk_order <= to)
    .sort((left, right) => left.chunk_order - right.chunk_order);
}

/** 解析并校验分页参数。 */
export function parsePaging(
  query: Record<string, string | string[] | undefined>
): { page: number; pageSize: number } {
  const rawPage = Array.isArray(query.page) ? query.page[0] : query.page;
  const rawSize = Array.isArray(query.page_size)
    ? query.page_size[0]
    : query.page_size;
  const page = Number.parseInt(rawPage ?? '0', 10);
  const pageSize = Number.parseInt(rawSize ?? '20', 10);
  if (!Number.isInteger(page) || page < 0) {
    throw inputError('页码不合法。', ['page']);
  }
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 200) {
    throw inputError('每页条数不合法。', ['page_size']);
  }
  return { page, pageSize };
}
