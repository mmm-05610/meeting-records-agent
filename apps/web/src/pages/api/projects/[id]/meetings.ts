/**
 * /api/projects/{id}/meetings —— 项目下的会议记录列表与上传。
 *
 * GET  ?status=all|ready → { meetings: MeetingSummary[] }
 * POST multipart          → { meeting: MeetingSummary, existing: boolean }
 *
 * 上传采用 multipart/form-data（file/title/meeting_date/record_kind/
 * participants/time_precision/meeting_started_at）。为便于接入，也接受
 * application/json + file_base64（服务端解码后重算 sha256）。
 */

import type { NextApiRequest, NextApiResponse } from 'next';

import { requireSession } from '@/server/auth';
import {
  allowMethods,
  inputError,
  scopeForbidden,
  withApiErrors,
} from '@/server/errors';
import { ingestMeeting } from '@/server/ingest';
import {
  statusFromIngestion,
  toMeetingSummary,
  validateUpload,
} from '@/server/meeting';
import {
  parseContentType,
  parseMultipart,
  readRawBody,
} from '@/server/multipart';
import {
  r2rCountChunks,
  r2rGetCollection,
  r2rListCollectionDocuments,
} from '@/server/r2r';

export const config = {
  api: { bodyParser: false },
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function collectionIdOf(req: NextApiRequest): string {
  const raw = req.query.id;
  const value = Array.isArray(raw) ? raw[0] : raw;
  const id = (value ?? '').trim();
  if (!UUID_RE.test(id)) {
    throw inputError('项目 ID 不合法。', ['collection_id']);
  }
  return id;
}

interface RawUpload {
  filename: string;
  contentType: string;
  bytes: Buffer;
  fields: Record<string, string>;
}

async function readUploadPayload(req: NextApiRequest): Promise<RawUpload> {
  const { type, boundary } = parseContentType(req.headers['content-type']);
  const body = await readRawBody(req);

  if (type === 'multipart/form-data') {
    if (!boundary) {
      throw inputError('上传内容缺少 boundary。', ['file']);
    }
    const parsed = parseMultipart(body, boundary);
    const file =
      parsed.files.find((item) => item.field === 'file') ?? parsed.files[0];
    if (!file) {
      throw inputError('请选择要上传的文件。', ['file']);
    }
    return {
      filename: file.filename,
      contentType: file.contentType,
      bytes: file.data,
      fields: parsed.fields,
    };
  }

  if (type === 'application/json') {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(body.toString('utf8') || '{}') as Record<
        string,
        unknown
      >;
    } catch {
      throw inputError('请求体不是合法 JSON。', ['file']);
    }
    const base64 =
      typeof payload.file_base64 === 'string' ? payload.file_base64 : '';
    if (!base64) {
      throw inputError('请选择要上传的文件。', ['file']);
    }
    let bytes: Buffer;
    try {
      bytes = Buffer.from(base64, 'base64');
    } catch {
      throw inputError('文件内容不是合法的 base64。', ['file']);
    }
    const fields: Record<string, string> = {};
    for (const [key, value] of Object.entries(payload)) {
      if (key === 'file_base64') {
        continue;
      }
      if (typeof value === 'string') {
        fields[key] = value;
      } else if (Array.isArray(value)) {
        fields[key] = JSON.stringify(value);
      }
    }
    return {
      filename:
        typeof payload.filename === 'string' ? payload.filename : 'meeting.txt',
      contentType:
        typeof payload.content_type === 'string'
          ? payload.content_type
          : 'text/plain; charset=utf-8',
      bytes,
      fields,
    };
  }

  throw inputError('不支持的上传格式，请使用 multipart/form-data。', ['file']);
}

export default withApiErrors(
  async (req: NextApiRequest, res: NextApiResponse) => {
    const session = requireSession(req);
    const collectionId = collectionIdOf(req);

    if (req.method === 'GET') {
      const collection = await r2rGetCollection(session.token, collectionId);
      if (!collection?.id) {
        throw scopeForbidden('项目不存在或无权访问。', 404, ['collection_id']);
      }
      const documents = await r2rListCollectionDocuments(
        session.token,
        collectionId
      );
      const filter =
        typeof req.query.status === 'string' ? req.query.status : 'all';
      const meetings = [];
      for (const document of documents) {
        const chunkCount = await r2rCountChunks(session.token, document.id);
        const summary = toMeetingSummary(document, {
          collectionId,
          chunkCount,
        });
        if (filter !== 'all' && summary.status !== filter) {
          continue;
        }
        meetings.push(summary);
      }
      return res.status(200).json({ meetings });
    }

    if (req.method === 'POST') {
      await r2rGetCollection(session.token, collectionId);
      const payload = await readUploadPayload(req);
      const upload = validateUpload({
        filename: payload.filename,
        contentType: payload.contentType,
        bytes: payload.bytes,
        title: payload.fields.title,
        meeting_date: payload.fields.meeting_date,
        record_kind: payload.fields.record_kind,
        time_precision: payload.fields.time_precision,
        meeting_started_at: payload.fields.meeting_started_at,
        participants: payload.fields.participants,
      });
      const result = await ingestMeeting(session.token, collectionId, upload);
      return res.status(result.existing ? 200 : 201).json({
        meeting: result.meeting,
        existing: result.existing,
      });
    }

    return allowMethods(req, res, ['GET', 'POST']);
  }
);
