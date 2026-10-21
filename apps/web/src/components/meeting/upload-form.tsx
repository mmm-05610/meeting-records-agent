'use client';

import { Upload } from 'lucide-react';
import React, { useRef, useState } from 'react';

import {
  MeetingApiError,
  uploadMeeting,
  type MeetingSummary,
} from '@/components/meeting/api';
import { ErrorNotice } from '@/components/meeting/error-notice';
import { RECORD_KIND_LABELS } from '@/components/meeting/status-badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export interface UploadFormProps {
  projectId: string;
  onUploaded: (meeting: MeetingSummary, existing: boolean) => void;
}

type FieldKey =
  | 'file'
  | 'title'
  | 'meeting_date'
  | 'record_kind'
  | 'participants'
  | 'time_precision'
  | 'meeting_started_at';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function UploadForm({
  projectId,
  onUploaded,
}: UploadFormProps): JSX.Element {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [meetingDate, setMeetingDate] = useState('');
  const [recordKind, setRecordKind] = useState<'minutes' | 'transcript'>(
    'minutes'
  );
  const [participants, setParticipants] = useState('');
  const [timePrecision, setTimePrecision] = useState<'date' | 'datetime'>(
    'date'
  );
  const [startedAt, setStartedAt] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<MeetingApiError | null>(null);
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<FieldKey, string>>
  >({});
  const [notice, setNotice] = useState<string | null>(null);

  const reset = () => {
    setFile(null);
    setTitle('');
    setMeetingDate('');
    setRecordKind('minutes');
    setParticipants('');
    setTimePrecision('date');
    setStartedAt('');
    if (fileRef.current) {
      fileRef.current.value = '';
    }
  };

  const validate = (): boolean => {
    const next: Partial<Record<FieldKey, string>> = {};
    if (!file) {
      next.file = '请选择要上传的会议记录文件。';
    } else if (file.size === 0) {
      next.file = '文件内容为空，请选择有效的记录文件。';
    }
    if (!title.trim()) {
      next.title = '请填写会议标题。';
    }
    if (!meetingDate.trim()) {
      next.meeting_date = '请填写会议日期。';
    } else if (!DATE_PATTERN.test(meetingDate.trim())) {
      next.meeting_date = '会议日期格式应为 YYYY-MM-DD。';
    }
    if (timePrecision === 'datetime' && !startedAt) {
      next.meeting_started_at = '选择“日期与时间”时需要填写会议开始时间。';
    }
    setFieldErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setNotice(null);
    if (!validate() || !file) {
      return;
    }

    setSubmitting(true);
    try {
      const participantList = participants
        .split(/[,，、\s]+/)
        .map((item) => item.trim())
        .filter(Boolean);

      const result = await uploadMeeting(projectId, {
        file,
        title: title.trim(),
        meeting_date: meetingDate.trim(),
        record_kind: recordKind,
        participants: participantList,
        time_precision: timePrecision,
        ...(timePrecision === 'datetime' && startedAt
          ? { meeting_started_at: new Date(startedAt).toISOString() }
          : {}),
      });

      setNotice(
        result.existing
          ? '该记录已存在，系统没有重复导入，正在刷新列表。'
          : '上传成功，正在刷新列表。'
      );
      reset();
      onUploaded(result.meeting, result.existing);
    } catch (uploadError) {
      const apiError =
        uploadError instanceof MeetingApiError
          ? uploadError
          : new MeetingApiError({
              category: 'service_failure',
              message: '上传失败，请稍后重试。',
              retryable: true,
            });
      setError(apiError);
      const next: Partial<Record<FieldKey, string>> = {};
      for (const field of apiError.fields) {
        if (
          field === 'file' ||
          field === 'title' ||
          field === 'meeting_date' ||
          field === 'record_kind' ||
          field === 'participants' ||
          field === 'time_precision' ||
          field === 'meeting_started_at'
        ) {
          next[field] = apiError.message;
        }
      }
      setFieldErrors(next);
    } finally {
      setSubmitting(false);
    }
  };

  const fieldClass = (key: FieldKey) =>
    fieldErrors[key] ? 'border-red-500 focus-visible:ring-red-500' : '';

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 rounded-md border border-zinc-800 bg-zinc-950/40 p-4"
    >
      <div>
        <h2 className="text-sm font-semibold text-zinc-100">上传会议记录</h2>
        <p className="mt-1 text-xs text-zinc-400">
          支持纯文本或 Markdown 记录；标题、日期与记录类型会随记录一起保存。
        </p>
      </div>

      <ErrorNotice error={error} />

      {notice && (
        <p className="rounded-md border border-emerald-700/60 bg-emerald-950/20 p-2 text-xs text-emerald-200">
          {notice}
        </p>
      )}

      <div className="space-y-2">
        <Label htmlFor="meeting-file">记录文件</Label>
        <Input
          id="meeting-file"
          type="file"
          accept=".txt,.md,.markdown,text/plain,text/markdown"
          className={fieldClass('file')}
          onChange={(event) => {
            const picked = event.target.files?.[0] ?? null;
            setFile(picked);
            setFieldErrors((prev) => ({ ...prev, file: undefined }));
          }}
        />
        {fieldErrors.file && (
          <p className="text-xs text-red-400">{fieldErrors.file}</p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="meeting-title">会议标题</Label>
          <Input
            id="meeting-title"
            value={title}
            className={fieldClass('title')}
            placeholder="例如：产品需求评审会"
            onChange={(event) => {
              setTitle(event.target.value);
              setFieldErrors((prev) => ({ ...prev, title: undefined }));
            }}
          />
          {fieldErrors.title && (
            <p className="text-xs text-red-400">{fieldErrors.title}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="meeting-date">会议日期</Label>
          <Input
            id="meeting-date"
            type="date"
            value={meetingDate}
            className={fieldClass('meeting_date')}
            onChange={(event) => {
              setMeetingDate(event.target.value);
              setFieldErrors((prev) => ({ ...prev, meeting_date: undefined }));
            }}
          />
          {fieldErrors.meeting_date && (
            <p className="text-xs text-red-400">{fieldErrors.meeting_date}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="meeting-kind">记录类型</Label>
          <select
            id="meeting-kind"
            value={recordKind}
            className={`flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus:ring-2 focus:ring-ring ${fieldClass(
              'record_kind'
            )}`}
            onChange={(event) =>
              setRecordKind(
                event.target.value === 'transcript' ? 'transcript' : 'minutes'
              )
            }
          >
            <option value="minutes">{RECORD_KIND_LABELS.minutes}</option>
            <option value="transcript">{RECORD_KIND_LABELS.transcript}</option>
          </select>
          {fieldErrors.record_kind && (
            <p className="text-xs text-red-400">{fieldErrors.record_kind}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="meeting-participants">参与人</Label>
          <Input
            id="meeting-participants"
            value={participants}
            className={fieldClass('participants')}
            placeholder="用顿号或逗号分隔，例如：张三、李四"
            onChange={(event) => {
              setParticipants(event.target.value);
              setFieldErrors((prev) => ({ ...prev, participants: undefined }));
            }}
          />
          {fieldErrors.participants && (
            <p className="text-xs text-red-400">{fieldErrors.participants}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="meeting-time-precision">时间精度</Label>
          <select
            id="meeting-time-precision"
            value={timePrecision}
            className={`flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus:ring-2 focus:ring-ring ${fieldClass(
              'time_precision'
            )}`}
            onChange={(event) =>
              setTimePrecision(
                event.target.value === 'datetime' ? 'datetime' : 'date'
              )
            }
          >
            <option value="date">仅日期</option>
            <option value="datetime">日期与时间</option>
          </select>
          {fieldErrors.time_precision && (
            <p className="text-xs text-red-400">{fieldErrors.time_precision}</p>
          )}
        </div>

        {timePrecision === 'datetime' && (
          <div className="space-y-2">
            <Label htmlFor="meeting-started-at">会议开始时间</Label>
            <Input
              id="meeting-started-at"
              type="datetime-local"
              value={startedAt}
              className={fieldClass('meeting_started_at')}
              onChange={(event) => {
                setStartedAt(event.target.value);
                setFieldErrors((prev) => ({
                  ...prev,
                  meeting_started_at: undefined,
                }));
              }}
            />
            {fieldErrors.meeting_started_at && (
              <p className="text-xs text-red-400">
                {fieldErrors.meeting_started_at}
              </p>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-3">
        <Button
          type="submit"
          color="filled"
          shape="rounded"
          disabled={submitting}
          className="px-4 py-2"
        >
          <Upload className="mr-2 h-4 w-4" />
          {submitting ? '上传中…' : '上传'}
        </Button>
        <Button
          type="button"
          color="transparent"
          shape="rounded"
          className="px-3 py-2"
          onClick={() => {
            reset();
            setFieldErrors({});
            setError(null);
            setNotice(null);
          }}
        >
          清空
        </Button>
      </div>
    </form>
  );
}

export default UploadForm;
