/**
 * HttpOnly 会话 Cookie 的签发与读取（T012 / C05）。
 *
 * Cookie 名 `mra_session`。载荷（R2R access token、用户身份、过期时间）
 * 用 MRA_SESSION_SECRET 派生的密钥做 AES-256-GCM 加密，并附 HMAC-SHA256 签名；
 * 浏览器只能看到密文，拿不到 R2R token。
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

import type { NextApiRequest, NextApiResponse } from 'next';

import { isProduction, sessionSecret } from './config';

export const SESSION_COOKIE = 'mra_session';

export interface SessionPayload {
  /** R2R 用户 ID。 */
  uid: string;
  /** R2R 用户邮箱。 */
  email: string;
  /** 角色：admin / user。 */
  role: 'admin' | 'user';
  /** R2R access token（只留在服务端与加密 Cookie 内）。 */
  token: string;
  /** 签发时间（秒）。 */
  iat: number;
  /** 过期时间（秒）。 */
  exp: number;
}

interface DerivedKeys {
  encKey: Buffer;
  macKey: Buffer;
}

function deriveKeys(secret: string): DerivedKeys {
  return {
    encKey: createHash('sha256').update(`mra:enc:${secret}`).digest(),
    macKey: createHash('sha256').update(`mra:mac:${secret}`).digest(),
  };
}

function b64url(buffer: Buffer): string {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function unb64url(value: string): Buffer {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(
    padded + '='.repeat((4 - (padded.length % 4)) % 4),
    'base64'
  );
}

function sign(iv: Buffer, body: Buffer, macKey: Buffer): Buffer {
  return createHmac('sha256', macKey).update(iv).update(body).digest();
}

/** 生成签名并加密后的 Cookie 值。 */
export function issueSession(
  payload: Omit<SessionPayload, 'iat' | 'exp'>,
  ttlSeconds: number
): { value: string; expiresAt: number } {
  const { encKey, macKey } = deriveKeys(sessionSecret());
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + ttlSeconds;
  const full: SessionPayload = { ...payload, iat: now, exp: expiresAt };

  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encKey, iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(full), 'utf8'),
    cipher.final(),
  ]);
  const body = Buffer.concat([encrypted, cipher.getAuthTag()]);
  const signature = sign(iv, body, macKey);

  return {
    value: `${b64url(iv)}.${b64url(body)}.${b64url(signature)}`,
    expiresAt,
  };
}

/** 校验签名并解密；任何异常都视为未登录。 */
export function readSession(
  value: string | undefined | null
): SessionPayload | null {
  if (!value) {
    return null;
  }
  const parts = value.split('.');
  if (parts.length !== 3) {
    return null;
  }
  try {
    const { encKey, macKey } = deriveKeys(sessionSecret());
    const iv = unb64url(parts[0]);
    const body = unb64url(parts[1]);
    const signature = unb64url(parts[2]);
    const expected = sign(iv, body, macKey);
    if (
      signature.length !== expected.length ||
      !timingSafeEqual(signature, expected)
    ) {
      return null;
    }
    const encrypted = body.subarray(0, body.length - 16);
    const tag = body.subarray(body.length - 16);
    const decipher = createDecipheriv('aes-256-gcm', encKey, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString('utf8');
    const payload = JSON.parse(plain) as SessionPayload;
    if (
      typeof payload?.uid !== 'string' ||
      typeof payload?.token !== 'string' ||
      typeof payload?.exp !== 'number'
    ) {
      return null;
    }
    if (payload.exp * 1000 <= Date.now()) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export function sessionCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    path: '/',
    sameSite: 'lax' as const,
    // Loopback HTTP is the documented local deployment; only mark the cookie Secure
    // when an operator explicitly terminates TLS (or runs in production behind TLS).
    secure: process.env.MRA_COOKIE_SECURE === 'true',
    maxAge: maxAgeSeconds,
  };
}

export function setSessionCookie(
  res: NextApiResponse,
  value: string,
  maxAgeSeconds: number
): void {
  res.setHeader('Set-Cookie', [
    `${SESSION_COOKIE}=${value}; ${serializeCookie(sessionCookieOptions(maxAgeSeconds))}`,
  ]);
}

export function clearSessionCookie(res: NextApiResponse): void {
  res.setHeader('Set-Cookie', [
    `${SESSION_COOKIE}=; ${serializeCookie({
      ...sessionCookieOptions(0),
      maxAge: 0,
    })}`,
  ]);
}

function serializeCookie(options: {
  httpOnly: boolean;
  path: string;
  sameSite: 'lax' | 'strict' | 'none';
  secure: boolean;
  maxAge: number;
}): string {
  const parts = [
    `Path=${options.path}`,
    `SameSite=${options.sameSite.charAt(0).toUpperCase()}${options.sameSite.slice(1)}`,
    `Max-Age=${options.maxAge}`,
  ];
  if (options.httpOnly) {
    parts.push('HttpOnly');
  }
  if (options.secure) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

/** 从请求中读取当前会话（未登录返回 null）。 */
export function getSession(req: NextApiRequest): SessionPayload | null {
  const raw = req.cookies?.[SESSION_COOKIE];
  return readSession(raw);
}
