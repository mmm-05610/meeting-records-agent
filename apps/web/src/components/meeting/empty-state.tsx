import { Loader2 } from 'lucide-react';
import React from 'react';

export function LoadingBlock({
  label = '加载中…',
  className,
}: {
  label?: string;
  className?: string;
}): JSX.Element {
  return (
    <div
      className={`flex items-center justify-center gap-2 py-10 text-sm text-zinc-400 ${className ?? ''}`}
      role="status"
      aria-live="polite"
    >
      <Loader2 className="h-4 w-4 animate-spin" />
      <span>{label}</span>
    </div>
  );
}

export function EmptyBlock({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <div
      className={`rounded-md border border-zinc-800 bg-zinc-950/40 px-4 py-8 text-center ${className ?? ''}`}
    >
      <p className="text-sm font-medium text-zinc-200">{title}</p>
      {description && (
        <p className="mx-auto mt-1 max-w-md text-xs text-zinc-400">
          {description}
        </p>
      )}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}
