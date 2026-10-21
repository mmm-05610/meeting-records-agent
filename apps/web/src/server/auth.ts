/**
 * 会话守卫：所有同源接口都必须先过这里。
 */

import type { NextApiRequest } from 'next';

import { scopeForbidden } from './errors';
import { getSession, type SessionPayload } from './session';

export function optionalSession(req: NextApiRequest): SessionPayload | null {
  return getSession(req);
}

export function requireSession(req: NextApiRequest): SessionPayload {
  const session = getSession(req);
  if (!session) {
    throw scopeForbidden('尚未登录或登录已过期，请重新登录。');
  }
  return session;
}
