/**
 * 服务端环境配置（T012）。浏览器不得读取这些值；
 * 严禁使用 NEXT_PUBLIC_* 承载 R2R / Agent 地址或凭据。
 */

const LOCAL_R2R_API_URL = 'http://127.0.0.1:7272';
const LOCAL_AGENT_API_URL = 'http://127.0.0.1:8080';

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

export function r2rApiUrl(): string {
  return trimTrailingSlash(process.env.R2R_API_URL || LOCAL_R2R_API_URL);
}

export function agentApiUrl(): string {
  return trimTrailingSlash(process.env.AGENT_API_URL || LOCAL_AGENT_API_URL);
}

/** 本地单账号管理员凭据；仅用于服务端换取 R2R token，不下发浏览器。 */
export function adminCredentials(): { email: string; password: string } | null {
  const email = process.env.R2R_ADMIN_EMAIL;
  const password = process.env.R2R_ADMIN_PASSWORD;
  if (!email || !password) {
    return null;
  }
  return { email, password };
}

export function sessionSecret(): string {
  const secret = process.env.MRA_SESSION_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error('MRA_SESSION_SECRET 未配置或长度不足（至少 16 位）');
  }
  return secret;
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

/** 单次上游请求超时（毫秒）。超时按 C08 归为 unknown_result。 */
export const UPSTREAM_TIMEOUT_MS = Number(
  process.env.MRA_UPSTREAM_TIMEOUT_MS || 120_000
);

/** 上传体积上限（字节）。 */
export const MAX_UPLOAD_BYTES = Number(
  process.env.MRA_MAX_UPLOAD_BYTES || 32 * 1024 * 1024
);
