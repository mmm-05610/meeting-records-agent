'use client';

import React, { useState } from 'react';

import {
  MeetingApiError,
  type DeleteMeetingResult,
  type MeetingSummary,
} from '@/components/meeting/api';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/Button';

export interface DeleteMeetingDialogProps {
  meeting: MeetingSummary | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (meeting: MeetingSummary) => Promise<DeleteMeetingResult>;
  onDeleted?: (meeting: MeetingSummary) => void;
}

export function DeleteMeetingDialog({
  meeting,
  open,
  onOpenChange,
  onConfirm,
  onDeleted,
}: DeleteMeetingDialogProps): JSX.Element {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<MeetingApiError | null>(null);

  const handleConfirm = async () => {
    if (!meeting) {
      return;
    }
    setPending(true);
    setError(null);
    try {
      const result = await onConfirm(meeting);
      if (result.deleted) {
        onOpenChange(false);
        onDeleted?.(meeting);
      } else {
        setError(
          new MeetingApiError({
            category: 'service_failure',
            message: '删除未完全成功：文件或片段清理存在失败项，请稍后重试。',
            retryable: true,
          })
        );
      }
    } catch (deleteError) {
      setError(
        deleteError instanceof MeetingApiError
          ? deleteError
          : new MeetingApiError({
              category: 'service_failure',
              message: '删除失败，请稍后重试。',
              retryable: true,
            })
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="bg-zinc-900 text-zinc-100">
        <AlertDialogHeader>
          <AlertDialogTitle>删除会议记录</AlertDialogTitle>
          <AlertDialogDescription>
            确认删除「{meeting?.title ?? ''}」吗？删除后该会议不再参与问答，
            历史回答中引用它的片段会显示为“引用失效”。此操作不可撤销。
          </AlertDialogDescription>
        </AlertDialogHeader>

        {error && (
          <p className="rounded-md border border-red-600/60 bg-red-950/30 p-2 text-xs text-red-200">
            {error.message}
          </p>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel className="bg-transparent text-zinc-300 hover:bg-zinc-800">
            取消
          </AlertDialogCancel>
          <Button
            color="danger"
            shape="rounded"
            className="px-4 py-2"
            disabled={pending}
            onClick={() => void handleConfirm()}
          >
            {pending ? '删除中…' : '确认删除'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default DeleteMeetingDialog;
