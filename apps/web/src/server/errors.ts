/**
 * C08 错误分类与统一响应封装。
 *
 * 所有失败响应形如：
 *   { "error": { "category": "<C08>", "message": "...", "fields": [], "retryable": false } }
 */

import type { NextApiRequest, NextApiResponse } from 'next';

import type { ErrorCategory, MeetingError } from '../types/meeting-contracts';

export class ApiError extends Error {
  readonly status: number;

  readonly category: ErrorCategory;

  readonly fields: string[];

  readonly retryable: boolean;

  constructor(
    status: number,
    category: ErrorCategory,
    message: string,
    fields: string[] = [],
    retryable = false
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.category = category;
    this.fields = fields;
    this.retryable = retryable;
  }
}

export function inputError(
  message: string,
  fields: string[] = [],
  status = 400
): ApiError {
  return new ApiError(status, 'input_error', message, fields, false);
}

export function scopeForbidden(
  message: string,
  status = 401,
  fields: string[] = []
): ApiError {
  return new ApiError(status, 'scope_forbidden', message, fields, false);
}

export function serviceFailure(
  message: string,
  status = 500,
  retryable = true
): ApiError {
  return new ApiError(status, 'service_failure', message, [], retryable);
}

export function unknownResult(
  message: string,
  fields: string[] = []
): ApiError {
  return new ApiError(504, 'unknown_result', message, fields, true);
}

export function duplicateProcessing(message: string): ApiError {
  return new ApiError(409, 'duplicate_processing', message, [], false);
}

export function errorEnvelope(error: ApiError): MeetingError {
  return {
    category: error.category,
    message: error.message,
    fields: error.fields,
    retryable: error.retryable,
  };
}

/** 不泄露内部细节的通用提示。 */
export function safeMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  return '服务端处理失败，请稍后重试。';
}

export function sendError(res: NextApiResponse, error: unknown): void {
  if (error instanceof ApiError) {
    return res.status(error.status).json({ error: errorEnvelope(error) });
  }
  // 不把内部异常原文写进响应，避免泄露路径/凭据。
  console.error(
    '[web-api] 未预期异常:',
    error instanceof Error ? error.message : error
  );
  return res.status(500).json({
    error: {
      category: 'service_failure',
      message: '服务端处理失败，请稍后重试。',
      fields: [],
      retryable: true,
    },
  });
}

export type ApiHandler = (
  req: NextApiRequest,
  res: NextApiResponse
) => Promise<unknown> | unknown;

/** 包装路由处理函数：统一捕获异常并输出 C08 错误信封。 */
export function withApiErrors(handler: ApiHandler): ApiHandler {
  return async (req, res) => {
    try {
      return await handler(req, res);
    } catch (error) {
      return sendError(res, error);
    }
  };
}

/** 只允许指定 HTTP 方法，其余返回 405。 */
export function allowMethods(
  req: NextApiRequest,
  res: NextApiResponse,
  methods: string[]
): boolean {
  if (methods.includes(req.method || '')) {
    return true;
  }
  res.setHeader('Allow', methods.join(', '));
  sendError(
    res,
    new ApiError(405, 'input_error', '不支持的请求方法。', [], false)
  );
  return false;
}
