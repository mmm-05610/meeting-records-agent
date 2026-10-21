/**
 * POST /api/auth/login —— 服务端向 R2R 换取 token，写入 HttpOnly Cookie。
 * 不存在同源注册入口（POST /api/auth/register 一律 404）。
 */

import type { NextApiRequest, NextApiResponse } from 'next';

import { adminCredentials } from '@/server/config';
import {
  allowMethods,
  ApiError,
  inputError,
  scopeForbidden,
  withApiErrors,
} from '@/server/errors';
import { readJsonBody } from '@/server/multipart';
import { r2rLogin, r2rMe, r2rTokenExpiresAt } from '@/server/r2r';
import { issueSession, setSessionCookie } from '@/server/session';

export const config = {
  api: { bodyParser: false },
};

const SESSION_TTL_SECONDS = Number(
  process.env.MRA_SESSION_TTL_SECONDS || 60 * 60
);

export default withApiErrors(
  async (req: NextApiRequest, res: NextApiResponse) => {
    if (!allowMethods(req, res, ['POST'])) {
      return;
    }

    const body = await readJsonBody(req);
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';

    const fields: string[] = [];
    if (!email) {
      fields.push('email');
    }
    if (!password) {
      fields.push('password');
    }
    if (fields.length > 0) {
      throw inputError('请填写邮箱和密码。', fields);
    }

    const admin = adminCredentials();
    if (admin && email.toLowerCase() !== admin.email.toLowerCase()) {
      throw scopeForbidden('本版本仅支持本地单账号登录。', 403, ['email']);
    }

    let accessToken: string;
    try {
      const tokens = await r2rLogin(email, password);
      accessToken = tokens.accessToken;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        throw scopeForbidden('邮箱或密码不正确。');
      }
      throw error;
    }

    const user = await r2rMe(accessToken);

    const ttl = Math.min(
      SESSION_TTL_SECONDS,
      r2rTokenExpiresAt(accessToken)
        ? Math.max(
            60,
            r2rTokenExpiresAt(accessToken)! - Math.floor(Date.now() / 1000)
          )
        : SESSION_TTL_SECONDS
    );

    const session = issueSession(
      {
        uid: user.id,
        email: user.email,
        role: user.is_superuser ? 'admin' : 'user',
        token: accessToken,
      },
      ttl
    );
    setSessionCookie(res, session.value, ttl);

    return res.status(200).json({
      user: {
        id: user.id,
        email: user.email,
        role: user.is_superuser ? 'admin' : 'user',
      },
    });
  }
);
