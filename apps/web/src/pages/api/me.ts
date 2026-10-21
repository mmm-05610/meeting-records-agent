/**
 * GET /api/me —— 返回服务端确认的当前账号。
 */

import type { NextApiRequest, NextApiResponse } from 'next';

import { requireSession } from '@/server/auth';
import { allowMethods, ApiError, withApiErrors } from '@/server/errors';
import { r2rMe } from '@/server/r2r';
import { clearSessionCookie } from '@/server/session';

export default withApiErrors(
  async (req: NextApiRequest, res: NextApiResponse) => {
    if (!allowMethods(req, res, ['GET'])) {
      return;
    }

    const session = requireSession(req);

    try {
      const user = await r2rMe(session.token);
      return res.status(200).json({
        user: {
          id: user.id,
          email: user.email,
          role: user.is_superuser ? 'admin' : 'user',
        },
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        clearSessionCookie(res);
        throw error;
      }
      throw error;
    }
  }
);
