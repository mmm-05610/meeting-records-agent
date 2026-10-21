/**
 * GET /api/meetings/{id}/chunks/{chunkId}/neighbors?radius=1 → { items: ChunkItem[] }
 */

import type { NextApiRequest, NextApiResponse } from 'next';

import { requireSession } from '@/server/auth';
import { readNeighbors } from '@/server/chunks';
import {
  allowMethods,
  inputError,
  scopeForbidden,
  withApiErrors,
} from '@/server/errors';

export default withApiErrors(
  async (req: NextApiRequest, res: NextApiResponse) => {
    if (!allowMethods(req, res, ['GET'])) {
      return;
    }
    const session = requireSession(req);
    const rawId = req.query.id;
    const rawChunk = req.query.chunkId;
    const documentId = (Array.isArray(rawId) ? rawId[0] : (rawId ?? '')).trim();
    const chunkId = (
      Array.isArray(rawChunk) ? rawChunk[0] : (rawChunk ?? '')
    ).trim();
    if (!documentId) {
      throw scopeForbidden('会议 ID 缺失。', 400);
    }
    if (!chunkId) {
      throw inputError('片段 ID 缺失。', ['chunk_id']);
    }

    const rawRadius = Array.isArray(req.query.radius)
      ? req.query.radius[0]
      : req.query.radius;
    const radius = Number.parseInt(rawRadius ?? '1', 10);
    if (!Number.isInteger(radius) || radius < 0 || radius > 20) {
      throw inputError('相邻片段半径不合法。', ['radius']);
    }

    const items = await readNeighbors(
      session.token,
      documentId,
      chunkId,
      radius
    );
    return res.status(200).json({ items });
  }
);
