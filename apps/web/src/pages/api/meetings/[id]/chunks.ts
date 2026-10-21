/**
 * GET /api/meetings/{id}/chunks?page=0&page_size=20 → { chunks: ChunksPage }
 */

import type { NextApiRequest, NextApiResponse } from 'next';

import { requireSession } from '@/server/auth';
import { parsePaging, readChunksPage } from '@/server/chunks';
import { allowMethods, scopeForbidden, withApiErrors } from '@/server/errors';

export default withApiErrors(
  async (req: NextApiRequest, res: NextApiResponse) => {
    if (!allowMethods(req, res, ['GET'])) {
      return;
    }
    const session = requireSession(req);
    const raw = req.query.id;
    const documentId = (Array.isArray(raw) ? raw[0] : (raw ?? '')).trim();
    if (!documentId) {
      throw scopeForbidden('会议 ID 缺失。', 400);
    }
    const { page, pageSize } = parsePaging(req.query);
    const chunks = await readChunksPage(
      session.token,
      documentId,
      page,
      pageSize
    );
    return res.status(200).json({ chunks });
  }
);
