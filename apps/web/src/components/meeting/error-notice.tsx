import { AlertCircle } from 'lucide-react';
import React from 'react';

import { fieldLabel, type MeetingApiError } from '@/components/meeting/api';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/Button';
import type { ErrorCategory } from '@/types/meeting-contracts';

export interface ErrorNoticeProps {
  error: MeetingApiError | null;
  onRetry?: () => void;
  className?: string;
}

/** 每个错误分类对应的中文可操作提示。 */
export const ERROR_CATEGORY_HINTS: Record<ErrorCategory, string> = {
  input_error: '请检查填写的内容后重试。',
  scope_forbidden: '请重新登录，或换一个项目 / 范围后再试。',
  duplicate_processing: '同一份记录正在处理中，请稍后再试。',
  unknown_result: '结果未知，可以重新提问确认。',
  service_failure: '服务暂时不可用，请稍后重试。',
  budget_exceeded: '请缩小范围（少选几场会议）后重试。',
  invalid_citation: '该引用已失效，请重新提问。',
  stale_scope: '会议范围已发生变化，请重新选择范围后再提问。',
};

export function errorHint(error: MeetingApiError | null): string {
  if (!error) {
    return '';
  }
  return ERROR_CATEGORY_HINTS[error.category] ?? '请稍后重试。';
}

/** 按 C08 分类显示服务端错误，并把错误落到具体字段上。 */
export function ErrorNotice({
  error,
  onRetry,
  className,
}: ErrorNoticeProps): JSX.Element | null {
  if (!error) {
    return null;
  }
  return (
    <Alert variant="destructive" className={className}>
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>{error.label}</AlertTitle>
      <AlertDescription>
        <p className="break-words">{error.message}</p>
        <p className="mt-1 break-words text-xs opacity-90">
          {errorHint(error)}
        </p>
        {error.fields.length > 0 && (
          <p className="mt-1 text-xs">
            涉及字段：
            {error.fields.map((field) => fieldLabel(field)).join('、')}
          </p>
        )}
        {onRetry && error.retryable && (
          <Button
            className="mt-3 px-3 py-1 text-sm"
            color="secondary"
            shape="outline"
            onClick={onRetry}
          >
            重试
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}

/** 取服务端指出的字段集合，便于表单逐项标红。 */
export function errorFields(error: MeetingApiError | null): Set<string> {
  return new Set(error?.fields ?? []);
}

export default ErrorNotice;
