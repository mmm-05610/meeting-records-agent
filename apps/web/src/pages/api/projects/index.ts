/**
 * /api/projects —— R2R collections 即项目。
 *
 * GET  → { projects: [{id,name,description,created_at}] }
 * POST → { project: {id,name} }；重名 409 duplicate_processing
 */

import type { NextApiRequest, NextApiResponse } from 'next';

import { requireSession } from '@/server/auth';
import {
  allowMethods,
  ApiError,
  duplicateProcessing,
  inputError,
  withApiErrors,
} from '@/server/errors';
import { readJsonBody } from '@/server/multipart';
import { r2rCreateCollection, r2rListCollections } from '@/server/r2r';

export const config = {
  api: { bodyParser: false },
};

export default withApiErrors(
  async (req: NextApiRequest, res: NextApiResponse) => {
    const session = requireSession(req);

    if (req.method === 'GET') {
      const collections = await r2rListCollections(session.token);
      return res.status(200).json({
        projects: collections.map((collection) => ({
          id: collection.id,
          name: collection.name,
          description: collection.description ?? null,
          created_at: collection.created_at ?? null,
        })),
      });
    }

    if (req.method === 'POST') {
      const body = await readJsonBody(req);
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      const description =
        typeof body.description === 'string' ? body.description.trim() : '';
      if (!name) {
        throw inputError('请填写项目名称。', ['name']);
      }
      try {
        const collection = await r2rCreateCollection(
          session.token,
          name,
          description || undefined
        );
        return res.status(201).json({
          project: {
            id: collection.id,
            name: collection.name,
            description: collection.description ?? null,
            created_at: collection.created_at ?? null,
          },
        });
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          throw duplicateProcessing('同名项目已存在，请换一个名称。');
        }
        throw error;
      }
    }

    return allowMethods(req, res, ['GET', 'POST']);
  }
);
