'use client';

import {
  AlertCircle,
  CheckCircle2,
  CopyCheck,
  FileText,
  Upload,
} from 'lucide-react';
import React, { useCallback, useMemo, useRef, useState } from 'react';

import {
  MeetingApiError,
  uploadMeeting,
  type MeetingSummary,
  type ProjectSummary,
} from '@/components/meeting/api';
import { RECORD_KIND_LABELS } from '@/components/meeting/status-badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export interface UploadFormProps {
  projectId: string;
  /** 可选：目标项目列表，批量导入时可直接切换项目。 */
  projects?: ProjectSummary[];
  onProjectChange?: (projectId: string) => void;
  /** 单个文件上传结束（成功或重复）后回调，用于刷新列表。 */
  onUploaded?: (meeting: MeetingSummary, existing: boolean) => void;
  /** 整批上传结束（含失败）后回调。 */
  onFinished?: (summary: {
    success: number;
    duplicate: number;
    failed: number;
  }) => void;
}

type UploadStatus =
  | 'pending'
  | 'uploading'
  | 'success'
  | 'duplicate'
  | 'failed';

interface PendingFile {
  id: string;
  file: File;
  title: string;
  titleTouched: boolean;
  meetingDate: string;
  dateTouched: boolean;
  status: UploadStatus;
  error: string | null;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const STATUS_TEXT: Record<UploadStatus, string> = {
  pending: '待上传',
  uploading: '上传中…',
  success: '上传成功',
  duplicate: '重复已存在',
  failed: '上传失败',
};

function todayString(): string {
  const now = new Date();
  const month = `${now.getMonth() + 1}`.padStart(2, '0');
  const day = `${now.getDate()}`.padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/** 默认标题取文件名（去扩展名）。 */
function titleFromFileName(name: string): string {
  const base = name.replace(/\\/g, '/').split('/').pop() ?? name;
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  return stem.trim() || base;
}

function localId(): string {
  if (
    typeof globalThis !== 'undefined' &&
    globalThis.crypto &&
    typeof globalThis.crypto.randomUUID === 'function'
  ) {
    return globalThis.crypto.randomUUID();
  }
  return `upload-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/**
 * 批量上传卡片：支持一次选择多个文件，逐个文件调用后端上传接口，
 * 并逐文件展示「上传中 / 成功 / 重复已存在 / 失败」与错误信息。
 */
export function UploadForm({
  projectId,
  projects,
  onProjectChange,
  onUploaded,
  onFinished,
}: UploadFormProps): JSX.Element {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [items, setItems] = useState<PendingFile[]>([]);
  const defaultDate = useMemo(() => todayString(), []);
  const [recordKind, setRecordKind] = useState<'minutes' | 'transcript'>(
    'minutes'
  );
  const [participants, setParticipants] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const counts = useMemo(
    () => ({
      success: items.filter((item) => item.status === 'success').length,
      duplicate: items.filter((item) => item.status === 'duplicate').length,
      failed: items.filter((item) => item.status === 'failed').length,
      pending: items.filter(
        (item) => item.status === 'pending' || item.status === 'failed'
      ).length,
    }),
    [items]
  );

  const addFiles = useCallback(
    (fileList: FileList | File[] | null) => {
      if (!fileList) {
        return;
      }
      const picked = Array.from(fileList).filter((file) => file.size > 0);
      if (picked.length === 0) {
        setFormError('所选文件内容为空，请选择有效的记录文件。');
        return;
      }
      setFormError(null);
      setItems((current) => [
        ...current,
        ...picked.map((file) => ({
          id: localId(),
          file,
          title: titleFromFileName(file.name),
          titleTouched: false,
          meetingDate: defaultDate,
          dateTouched: false,
          status: 'pending' as UploadStatus,
          error: null,
        })),
      ]);
    },
    [defaultDate]
  );

  const patchItem = useCallback((id: string, patch: Partial<PendingFile>) => {
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item))
    );
  }, []);

  const removeItem = useCallback((id: string) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const clearAll = useCallback(() => {
    setItems([]);
    setFormError(null);
    if (fileRef.current) {
      fileRef.current.value = '';
    }
  }, []);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);

    if (!projectId) {
      setFormError('请先选择要导入到的项目。');
      return;
    }
    const todo = items.filter(
      (item) => item.status === 'pending' || item.status === 'failed'
    );
    if (todo.length === 0) {
      setFormError('请先选择要导入的会议记录文件。');
      return;
    }
    const invalidTitle = todo.find((item) => !item.title.trim());
    if (invalidTitle) {
      setFormError(
        '请为每个文件填写会议标题（默认已按文件名生成，可直接修改）。'
      );
      return;
    }
    const invalidDate = todo.find(
      (item) => !DATE_PATTERN.test(item.meetingDate.trim())
    );
    if (invalidDate) {
      setFormError('会议日期格式应为 YYYY-MM-DD，请检查每个文件对应的日期。');
      return;
    }

    const participantList = participants
      .split(/[,，、\s]+/)
      .map((item) => item.trim())
      .filter(Boolean);

    setSubmitting(true);
    let success = 0;
    let duplicate = 0;
    let failed = 0;

    // 后端一次只接受一个文件，这里按用户选择顺序依次调用。
    for (const item of todo) {
      patchItem(item.id, { status: 'uploading', error: null });
      try {
        const result = await uploadMeeting(projectId, {
          file: item.file,
          title: item.title.trim(),
          meeting_date: item.meetingDate.trim(),
          record_kind: recordKind,
          participants: participantList,
          time_precision: 'date',
        });
        if (result.existing) {
          duplicate += 1;
          patchItem(item.id, { status: 'duplicate', error: null });
        } else {
          success += 1;
          patchItem(item.id, { status: 'success', error: null });
        }
        onUploaded?.(result.meeting, result.existing);
      } catch (error) {
        failed += 1;
        const apiError =
          error instanceof MeetingApiError
            ? error
            : new MeetingApiError({
                category: 'service_failure',
                message: '上传失败，请稍后重试。',
                retryable: true,
              });
        patchItem(item.id, {
          status: 'failed',
          error: `${apiError.label}：${apiError.message}`,
        });
      }
    }

    setSubmitting(false);
    onFinished?.({ success, duplicate, failed });
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-md border border-accent-base/40 bg-zinc-950/50 p-4 shadow-lg shadow-black/20"
      aria-label="导入会议记录"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-zinc-100">
            导入会议记录
          </h2>
          <p className="mt-1 text-xs text-zinc-400">
            支持一次选择多个 TXT / Markdown 文件，逐个导入并显示每个文件的结果。
          </p>
        </div>
        {items.length > 0 && (
          <span className="rounded-full border border-zinc-800 px-2.5 py-1 text-[11px] text-zinc-400">
            成功 {counts.success} · 重复 {counts.duplicate} · 失败{' '}
            {counts.failed}
          </span>
        )}
      </div>

      {formError && (
        <p className="mt-3 rounded-md border border-amber-700/60 bg-amber-950/20 p-2 text-xs text-amber-200">
          {formError}
        </p>
      )}

      {/* 目标项目 */}
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {projects && projects.length > 0 ? (
          <div className="space-y-1.5">
            <Label htmlFor="upload-project">导入到项目</Label>
            <select
              id="upload-project"
              value={projectId}
              onChange={(event) => onProjectChange?.(event.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">请选择项目</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div className="space-y-1.5">
            <Label htmlFor="upload-project-readonly">导入到项目</Label>
            <Input
              id="upload-project-readonly"
              value={projectId}
              readOnly
              className="opacity-70"
            />
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="upload-kind">记录类型</Label>
          <select
            id="upload-kind"
            value={recordKind}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus:ring-2 focus:ring-ring"
            onChange={(event) =>
              setRecordKind(
                event.target.value === 'transcript' ? 'transcript' : 'minutes'
              )
            }
          >
            <option value="minutes">{RECORD_KIND_LABELS.minutes}</option>
            <option value="transcript">{RECORD_KIND_LABELS.transcript}</option>
          </select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="upload-participants">参与人</Label>
          <Input
            id="upload-participants"
            value={participants}
            placeholder="用顿号或逗号分隔，例如：张三、李四"
            onChange={(event) => setParticipants(event.target.value)}
          />
          <p className="text-[11px] text-zinc-500">
            参与人适用于本次导入的所有文件。
          </p>
        </div>
      </div>

      {/* 文件选择 */}
      <div className="mt-4">
        <Label htmlFor="meeting-files">会议记录文件（可多选）</Label>
        <div
          className={`mt-1.5 rounded-md border border-dashed p-3 transition-colors ${
            dragging
              ? 'border-accent-base bg-accent-base/10'
              : 'border-zinc-700 bg-zinc-950/40'
          }`}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            addFiles(event.dataTransfer.files);
          }}
        >
          <div className="flex flex-wrap items-center gap-3">
            <input
              id="meeting-files"
              ref={fileRef}
              type="file"
              multiple
              accept=".txt,.md,.markdown,text/plain,text/markdown"
              className="block w-full max-w-full text-xs text-zinc-300 file:mr-3 file:rounded-md file:border-0 file:bg-accent-base/20 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-accent-base hover:file:bg-accent-base/30 focus:outline-none focus:ring-2 focus:ring-accent-base"
              onChange={(event) => {
                addFiles(event.target.files);
                if (fileRef.current) {
                  fileRef.current.value = '';
                }
              }}
            />
          </div>
          <p className="mt-2 text-[11px] text-zinc-500">
            也可以把文件拖到这里；每个文件会在下方单独填写标题与会议日期。
          </p>
        </div>
      </div>

      {/* 文件清单 */}
      {items.length > 0 && (
        <ul className="mt-4 space-y-2" aria-label="待导入文件列表">
          {items.map((item) => (
            <li
              key={item.id}
              className="rounded-md border border-zinc-800 bg-zinc-950/60 p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <p
                  className="flex min-w-0 items-center gap-1.5 text-xs text-zinc-200"
                  title={item.file.name}
                >
                  <FileText className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                  <span className="truncate">{item.file.name}</span>
                  <span className="shrink-0 text-[10px] text-zinc-500">
                    {(item.file.size / 1024).toFixed(1)} KB
                  </span>
                </p>
                <span
                  className={`flex shrink-0 items-center gap-1 text-[11px] ${
                    item.status === 'success'
                      ? 'text-emerald-300'
                      : item.status === 'duplicate'
                        ? 'text-amber-300'
                        : item.status === 'failed'
                          ? 'text-red-300'
                          : item.status === 'uploading'
                            ? 'text-sky-300'
                            : 'text-zinc-500'
                  }`}
                  role="status"
                >
                  {item.status === 'success' && (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  )}
                  {item.status === 'duplicate' && (
                    <CopyCheck className="h-3.5 w-3.5" />
                  )}
                  {item.status === 'failed' && (
                    <AlertCircle className="h-3.5 w-3.5" />
                  )}
                  {STATUS_TEXT[item.status]}
                </span>
              </div>

              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] sm:items-end">
                <div className="space-y-1">
                  <Label
                    htmlFor={`upload-title-${item.id}`}
                    className="text-[11px] text-zinc-400"
                  >
                    会议标题
                  </Label>
                  <Input
                    id={`upload-title-${item.id}`}
                    value={item.title}
                    className="h-9 text-xs"
                    onChange={(event) =>
                      patchItem(item.id, {
                        title: event.target.value,
                        titleTouched: true,
                      })
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label
                    htmlFor={`upload-date-${item.id}`}
                    className="text-[11px] text-zinc-400"
                  >
                    会议日期
                  </Label>
                  <Input
                    id={`upload-date-${item.id}`}
                    type="date"
                    value={item.meetingDate}
                    className="h-9 text-xs"
                    onChange={(event) =>
                      patchItem(item.id, {
                        meetingDate: event.target.value,
                        dateTouched: true,
                      })
                    }
                  />
                </div>
                <Button
                  type="button"
                  color="transparent"
                  shape="rounded"
                  className="px-2 py-1.5 text-xs text-zinc-400"
                  onClick={() => removeItem(item.id)}
                  aria-label={`从待导入列表移除 ${item.file.name}`}
                  disabled={item.status === 'uploading'}
                >
                  移除
                </Button>
              </div>

              {item.error && (
                <p className="mt-2 break-words text-[11px] text-red-300">
                  {item.error}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          type="submit"
          color="filled"
          shape="rounded"
          className="px-4 py-2"
          disabled={submitting}
        >
          <Upload className="mr-2 h-4 w-4" />
          {submitting
            ? '上传中…'
            : `开始上传${counts.pending > 0 ? `（${counts.pending}）` : ''}`}
        </Button>
        <Button
          type="button"
          color="transparent"
          shape="rounded"
          className="px-3 py-2"
          onClick={clearAll}
          disabled={submitting}
        >
          清空
        </Button>
        <p className="text-[11px] text-zinc-500">
          标题默认取文件名，可逐个修改；会议日期默认填今天，可逐个调整。
        </p>
      </div>
    </form>
  );
}

export default UploadForm;
