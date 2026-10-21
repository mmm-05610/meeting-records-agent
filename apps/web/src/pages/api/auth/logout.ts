/**
 * POST /api/auth/logout —— 清除本地会话 Cookie。
 */

import type { NextApiRequest, NextApiResponse } from 'next';

import { allowMethods, withApiErrors } from '@/server/errors';
import { clearSessionCookie } from '@/server/session';

export default withApiErrors(
  async (req: NextApiRequest, res: NextApiResponse) => {
    if (!allowMethods(req, res, ['POST'])) {
      return;
    }
    clearSessionCookie(res);
    return res.status(200).json({ ok: true });
  }
);
