/**
 * Cross-module contract C01-C08, TypeScript mirror of
 * apps/agent/src/schema/meeting.py (see docs/contracts-v0.1.md).
 *
 * Types only plus pure helpers; no Node-only APIs so client components can import it.
 */

export const MEETING_SCHEMA_VERSION = 'meeting-v0.1';

export type RecordKind = 'transcript' | 'minutes';
export type TimePrecision = 'date' | 'datetime';
export type ScopeMode = 'all_ready' | 'explicit';
export type ClaimKind =
  | 'fact'
  | 'proposal'
  | 'confirmed'
  | 'change'
  | 'conflict'
  | 'unknown';
export type AnswerStatus = 'completed' | 'failed' | 'interrupted';
export type DocumentStatus = 'ready' | 'processing' | 'failed' | 'unknown';
export type ErrorCategory =
  | 'input_error'
  | 'scope_forbidden'
  | 'duplicate_processing'
  | 'unknown_result'
  | 'service_failure'
  | 'budget_exceeded'
  | 'invalid_citation'
  | 'stale_scope';

export interface MeetingMetadata {
  collection_id: string;
  title: string;
  meeting_date: string;
  meeting_started_at?: string | null;
  time_precision: TimePrecision;
  record_kind: RecordKind;
  participants: string[];
  content_sha256: string;
  schema_version: typeof MEETING_SCHEMA_VERSION;
  document_id: string;
}

export interface ScopeRequest {
  collection_id: string;
  mode: ScopeMode;
  document_ids?: string[];
}

export interface ScopeDocument {
  document_id: string;
  collection_id: string;
  title?: string | null;
  content_sha256?: string | null;
  meeting_date?: string | null;
  time_precision?: TimePrecision | null;
  record_kind?: RecordKind | null;
  status: DocumentStatus;
}

export interface ScopeSnapshot {
  collection_id: string;
  mode: ScopeMode;
  documents: ScopeDocument[];
  created_at: string;
  fingerprint: string;
}

export interface EvidenceChunk {
  source_key: string;
  document_id: string;
  chunk_id: string;
  chunk_order: number;
  text: string;
  title?: string | null;
  meeting_date?: string | null;
  meeting_started_at?: string | null;
  record_kind?: RecordKind | null;
  content_sha256?: string | null;
  score?: number | null;
}

export interface SourceRef {
  source_key: string;
  document_id: string;
  chunk_id: string;
  chunk_order: number;
  title?: string | null;
  meeting_date?: string | null;
  record_kind?: RecordKind | null;
  quote: string;
  display_index?: number | null;
}

export interface Claim {
  text: string;
  kind: ClaimKind;
  evidence_ids: string[];
}

export interface Coverage {
  checked: string[];
  unchecked: string[];
  failed: string[];
  budget_exhausted?: boolean;
}

export interface AnswerRecord {
  message_id: string;
  run_id: string;
  text: string;
  claims: Claim[];
  sources: Record<string, SourceRef>;
  scope_snapshot: ScopeSnapshot;
  coverage: Coverage;
  created_at: string;
  model_config_id: string;
  status: AnswerStatus;
}

export interface MeetingError {
  category: ErrorCategory;
  message: string;
  fields?: string[];
  retryable?: boolean;
}

export interface AgUiStateProjection {
  meeting_scope: ScopeSnapshot;
  progress: string[];
  answer_record: AnswerRecord | null;
  clarification: string | null;
}

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function normalizeTitle(value: string): string {
  const collapsed = value
    .normalize('NFC')
    .split(/\s+/u)
    .filter(Boolean)
    .join(' ');
  if (!collapsed) {
    throw new Error('title must not be blank');
  }
  return collapsed;
}

export function normalizeSha256(value: string): string {
  const digest = value.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(digest)) {
    throw new Error('content_sha256 must be 64 lowercase hex characters');
  }
  return digest;
}

export function canonicalJson(payload: unknown): string {
  if (payload === null || typeof payload !== 'object') {
    return JSON.stringify(payload);
  }
  if (Array.isArray(payload)) {
    return `[${payload.map((item) => canonicalJson(item)).join(',')}]`;
  }
  const record = payload as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const parts = keys.map(
    (key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`
  );
  return `{${parts.join(',')}}`;
}
