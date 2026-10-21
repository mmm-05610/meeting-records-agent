/**
 * 最小 multipart/form-data 解析（不引入新依赖）。
 *
 * 仅用于 Pages Router 的 `bodyParser: false` 路由：先把请求流读成 Buffer，
 * 再按 boundary 切分出普通字段与文件字段。
 */

import type { NextApiRequest } from 'next';

import { MAX_UPLOAD_BYTES } from './config';
import { inputError } from './errors';

export interface MultipartFile {
  field: string;
  filename: string;
  contentType: string;
  data: Buffer;
}

export interface MultipartBody {
  fields: Record<string, string>;
  files: MultipartFile[];
}

export function parseContentType(contentType: string | undefined): {
  type: string;
  boundary: string | null;
} {
  const raw = contentType ?? '';
  const [type, ...rest] = raw.split(';');
  const boundaryPart = rest
    .map((part) => part.trim())
    .find((part) => part.toLowerCase().startsWith('boundary='));
  if (!boundaryPart) {
    return { type: type.trim().toLowerCase(), boundary: null };
  }
  let boundary = boundaryPart.slice('boundary='.length).trim();
  if (boundary.startsWith('"') && boundary.endsWith('"')) {
    boundary = boundary.slice(1, -1);
  }
  return { type: type.trim().toLowerCase(), boundary };
}

/** 读取整个请求体（带体积上限）。 */
export async function readRawBody(
  req: NextApiRequest,
  maxBytes: number = MAX_UPLOAD_BYTES
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk)
      ? chunk
      : Buffer.from(chunk as string);
    size += buffer.length;
    if (size > maxBytes) {
      throw inputError('上传内容超过大小限制。', ['file']);
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

/** 读取并解析 JSON 请求体（路由需设置 bodyParser: false）。 */
export async function readJsonBody(
  req: NextApiRequest
): Promise<Record<string, unknown>> {
  const raw = await readRawBody(req);
  if (raw.length === 0) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString('utf8'));
  } catch {
    throw inputError('请求体不是合法 JSON。');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw inputError('请求体必须是 JSON 对象。');
  }
  return parsed as Record<string, unknown>;
}

/** 解析 multipart/form-data。 */
export function parseMultipart(body: Buffer, boundary: string): MultipartBody {
  const fields: Record<string, string> = {};
  const files: MultipartFile[] = [];
  const delimiter = Buffer.from(`\r\n--${boundary}`);
  const normalized = Buffer.concat([Buffer.from('\r\n'), body]);

  let cursor = normalized.indexOf(delimiter);
  if (cursor < 0) {
    throw inputError('上传内容格式无法解析。', ['file']);
  }

  while (cursor >= 0) {
    let start = cursor + delimiter.length;
    if (normalized.slice(start, start + 2).toString() === '--') {
      break;
    }
    if (normalized.slice(start, start + 2).toString() === '\r\n') {
      start += 2;
    } else {
      break;
    }

    const headerEnd = normalized.indexOf('\r\n\r\n', start);
    if (headerEnd < 0) {
      break;
    }
    const headerText = normalized.slice(start, headerEnd).toString('utf8');
    const bodyStart = headerEnd + 4;

    const next = normalized.indexOf(delimiter, bodyStart);
    const bodyEnd = next < 0 ? normalized.length : next;
    const partBody = normalized.slice(bodyStart, bodyEnd);

    const disposition =
      /content-disposition:([^\r\n]*)/i.exec(headerText)?.[1] ?? '';
    const nameMatch = /name="([^"]*)"/i.exec(disposition)?.[1];
    const filenameMatch = /filename="([^"]*)"/i.exec(disposition)?.[1];
    const contentTypeMatch = /content-type:\s*([^\r\n]+)/i.exec(
      headerText
    )?.[1];

    if (nameMatch) {
      if (filenameMatch !== undefined) {
        files.push({
          field: nameMatch,
          filename: filenameMatch,
          contentType: (contentTypeMatch ?? 'application/octet-stream').trim(),
          data: Buffer.from(partBody),
        });
      } else {
        fields[nameMatch] = partBody.toString('utf8');
      }
    }

    cursor = next;
  }

  return { fields, files };
}
