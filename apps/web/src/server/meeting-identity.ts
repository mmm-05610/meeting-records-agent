/**
 * Server-side meeting identity helpers (C01). Node-only: uses node:crypto.
 * Mirrors compute_document_id / ScopeSnapshot fingerprint in the agent schema.
 */

import { createHash } from 'node:crypto';

import {
  canonicalJson,
  normalizeSha256,
  normalizeTitle,
  type ScopeSnapshot,
} from '../types/meeting-contracts';

export const MEETING_DOCUMENT_NAMESPACE = uuid5(
  '6ba7b811-9dad-11d1-80b4-00c04fd430c8', // uuid.NAMESPACE_URL
  'https://meeting-records-agent.local/ns/meeting-document/v1'
);

export function uuid5(namespace: string, name: string): string {
  const ns = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  const hash = createHash('sha1')
    .update(ns)
    .update(Buffer.from(name, 'utf8'))
    .digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function sha256Hex(content: Buffer | Uint8Array | string): string {
  return createHash('sha256').update(content).digest('hex');
}

export function computeDocumentId(input: {
  collection_id: string;
  meeting_date: string;
  title: string;
  record_kind: string;
  content_sha256: string;
}): string {
  const name = [
    input.collection_id,
    input.meeting_date,
    normalizeTitle(input.title),
    input.record_kind,
    normalizeSha256(input.content_sha256),
  ].join('|');
  return uuid5(MEETING_DOCUMENT_NAMESPACE, name);
}

export function computeScopeFingerprint(snapshot: ScopeSnapshot): string {
  const payload = {
    collection_id: snapshot.collection_id,
    mode: snapshot.mode,
    documents: [...snapshot.documents]
      .sort((left, right) => left.document_id.localeCompare(right.document_id))
      .map((document) => ({
        document_id: document.document_id,
        content_sha256: document.content_sha256 ?? null,
        status: document.status,
      })),
  };
  return createHash('sha256')
    .update(canonicalJson(payload), 'utf8')
    .digest('hex');
}
