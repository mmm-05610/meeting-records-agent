import { AlertCircle } from 'lucide-react';
import React from 'react';

import { fieldLabel, type MeetingApiError } from '@/components/meeting/api';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/Button';

export interface ErrorNoticeProps {
  error: MeetingApiError | null;
  onRetry?: () => void;
  className?: string;
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
