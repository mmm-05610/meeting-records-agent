/**
 * 会议记录入库（C01 适配）。
 *
 * - 服务端计算 content_sha256 与确定性 document_id；
 * - 上传时 metadata 不含 title（R2R 会把 title 当文件名，导致扩展名丢失）；
 * - 上传成功后 PATCH 追加展示标题；
 * - 同 ID 重复上传幂等；处理中返回 409 duplicate_processing。
 */

import { ApiError, duplicateProcessing, serviceFailure } from './errors';
import {
  statusFromIngestion,
  titleOf,
  toMeetingSummary,
  type MeetingSummary,
  type ValidatedUpload,
} from './meeting';
import { sha256Hex, computeDocumentId } from './meeting-identity';
import {
  r2rAppendMetadata,
  r2rCountChunks,
  r2rDeleteDocument,
  r2rGetDocument,
  r2rUploadDocument,
} from './r2r';

export interface IngestResult {
  meeting: MeetingSummary;
  existing: boolean;
}

const SCHEMA_VERSION = 'meeting-v0.1';

export async function ingestMeeting(
  token: string,
  collectionId: string,
  upload: ValidatedUpload
): Promise<IngestResult> {
  const contentSha256 = sha256Hex(upload.bytes);
  const documentId = computeDocumentId({
    collection_id: collectionId,
    meeting_date: upload.meeting_date,
    title: upload.title,
    record_kind: upload.record_kind,
    content_sha256: contentSha256,
  });

  const metadata: Record<string, unknown> = {
    collection_ids: [collectionId],
    meeting_date: upload.meeting_date,
    time_precision: upload.time_precision,
    record_kind: upload.record_kind,
    participants: upload.participants,
    schema_version: SCHEMA_VERSION,
    content_sha256: contentSha256,
    document_id: documentId,
  };
  if (upload.meeting_started_at) {
    metadata.meeting_started_at = upload.meeting_started_at;
  }

  const existing = await r2rGetDocument(token, documentId);
  if (existing) {
    const status = statusFromIngestion(existing.ingestion_status);
    if (status === 'processing') {
      throw duplicateProcessing(
        '同一份会议记录正在处理中，请稍后刷新查看当前状态。'
      );
    }
    if (status === 'failed') {
      // 失败记录允许原 ID 重试：先清理再重新导入。
      try {
        await r2rDeleteDocument(token, documentId);
      } catch (error) {
        console.warn(
          '[web-api] 清理失败文档时出错:',
          error instanceof Error ? error.message : 'unknown'
        );
        return {
          meeting: await summarize(token, existing.id, collectionId),
          existing: true,
        };
      }
    } else {
      if (!titleOf(existing)) {
        await r2rAppendMetadata(token, documentId, [{ title: upload.title }]);
      }
      return {
        meeting: await summarize(token, documentId, collectionId),
        existing: true,
      };
    }
  }

  try {
    await r2rUploadDocument(token, {
      id: documentId,
      filename: upload.filename,
      contentType: upload.contentType,
      bytes: upload.bytes,
      collectionId,
      metadata,
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      const raced = await r2rGetDocument(token, documentId);
      if (raced) {
        const status = statusFromIngestion(raced.ingestion_status);
        if (status === 'processing') {
          throw duplicateProcessing(
            '同一份会议记录正在处理中，请稍后刷新查看当前状态。'
          );
        }
        return {
          meeting: await summarize(token, documentId, collectionId),
          existing: true,
        };
      }
    }
    throw error;
  }

  try {
    await r2rAppendMetadata(token, documentId, [{ title: upload.title }]);
  } catch (error) {
    throw serviceFailure('会议记录已写入但标题写入失败，请重试。', 500, true);
  }

  return {
    meeting: await summarize(token, documentId, collectionId),
    existing: false,
  };
}

async function summarize(
  token: string,
  documentId: string,
  collectionId: string
): Promise<MeetingSummary> {
  const document = await r2rGetDocument(token, documentId);
  if (!document) {
    throw serviceFailure('会议记录写入后无法读取，请稍后刷新查看。', 500, true);
  }
  const chunkCount = await r2rCountChunks(token, documentId);
  return toMeetingSummary(document, { collectionId, chunkCount });
}
