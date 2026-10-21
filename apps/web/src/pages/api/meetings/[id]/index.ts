/**
 * /api/meetings/{id} —— 会议详情与删除（C07）。
 *
 * GET    → { meeting: MeetingSummary, chunks: ChunksPage }
 * DELETE → { deleted, document_id, file_deleted, chunks_deleted }
 */

import type { NextApiRequest, NextApiResponse } from 'next';

import { requireSession } from '@/server/auth';
import { parsePaging, readChunksPage } from '@/server/chunks';
import {
  allowMethods,
  scopeForbidden,
  serviceFailure,
  withApiErrors,
} from '@/server/errors';
import { toMeetingSummary } from '@/server/meeting';
import {
  r2rCountChunks,
  r2rDeleteDocument,
  r2rGetDocument,
  r2rRemoveDocumentFromCollection,
} from '@/server/r2r';

export default withApiErrors(
  async (req: NextApiRequest, res: NextApiResponse) => {
    const session = requireSession(req);
    const raw = req.query.id;
    const documentId = (Array.isArray(raw) ? raw[0] : (raw ?? '')).trim();
    if (!documentId) {
      throw scopeForbidden('会议 ID 缺失。', 400);
    }

    if (req.method === 'GET') {
      const document = await r2rGetDocument(session.token, documentId);
      if (!document) {
        throw scopeForbidden('会议不存在或已被删除。', 404);
      }
      const chunkCount = await r2rCountChunks(session.token, documentId);
      const meeting = toMeetingSummary(document, {
        collectionId: document.collection_ids?.[0],
        chunkCount,
      });
      const { page, pageSize } = parsePaging(req.query);
      const chunks = await readChunksPage(
        session.token,
        documentId,
        page,
        pageSize
      );
      return res.status(200).json({ meeting, chunks });
    }

    if (req.method === 'DELETE') {
      const document = await r2rGetDocument(session.token, documentId);
      if (!document) {
        throw scopeForbidden('会议不存在或已被删除。', 404);
      }

      let fileDeleted = true;
      let chunksDeleted = false;
      const failures: string[] = [];

      for (const collectionId of document.collection_ids ?? []) {
        try {
          await r2rRemoveDocumentFromCollection(
            session.token,
            collectionId,
            documentId
          );
        } catch (error) {
          fileDeleted = false;
          failures.push(
            `移除项目归属失败（${collectionId}）：${
              error instanceof Error ? error.message : '未知错误'
            }`
          );
        }
      }

      try {
        await r2rDeleteDocument(session.token, documentId);
        chunksDeleted = true;
      } catch (error) {
        failures.push(
          `删除文档失败：${error instanceof Error ? error.message : '未知错误'}`
        );
      }

      // 复核：文档与分块都不可查询才算真正移除。
      const stillThere = await r2rGetDocument(session.token, documentId);
      if (stillThere) {
        chunksDeleted = false;
        failures.push('删除后仍能查询到该会议记录。');
      }

      if (failures.length > 0 || !fileDeleted || !chunksDeleted) {
        console.warn('[web-api] 删除会议记录未完全成功:', failures.join('; '));
        const error = serviceFailure(
          '会议记录未完全清理，请稍后重试。',
          500,
          true
        );
        return res.status(error.status).json({
          error: {
            category: error.category,
            message: error.message,
            fields: [],
            retryable: error.retryable,
          },
          deleted: false,
          document_id: documentId,
          file_deleted: fileDeleted,
          chunks_deleted: chunksDeleted,
        });
      }

      return res.status(200).json({
        deleted: true,
        document_id: documentId,
        file_deleted: true,
        chunks_deleted: true,
      });
    }

    return allowMethods(req, res, ['GET', 'DELETE']);
  }
);
