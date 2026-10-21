import React from 'react';

import type { MeetingSummary, ProjectSummary } from '@/components/meeting/api';
import { LoadingBlock } from '@/components/meeting/empty-state';
import {
  MeetingStatusBadge,
  RecordKindBadge,
} from '@/components/meeting/status-badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import type { ScopeMode } from '@/types/meeting-contracts';

export interface ScopePickerProps {
  projects: ProjectSummary[];
  projectsLoading: boolean;
  selectedProjectId: string;
  onSelectProject: (projectId: string) => void;
  mode: ScopeMode;
  onModeChange: (mode: ScopeMode) => void;
  meetings: MeetingSummary[];
  meetingsLoading: boolean;
  selectedDocumentIds: string[];
  onToggleDocument: (documentId: string) => void;
  onClearDocuments: () => void;
}

export function ScopePicker({
  projects,
  projectsLoading,
  selectedProjectId,
  onSelectProject,
  mode,
  onModeChange,
  meetings,
  meetingsLoading,
  selectedDocumentIds,
  onToggleDocument,
  onClearDocuments,
}: ScopePickerProps): JSX.Element {
  const readyMeetings = meetings.filter(
    (meeting) => meeting.status === 'ready'
  );

  return (
    <section className="space-y-4 rounded-md border border-zinc-800 bg-zinc-950/40 p-4">
      <div>
        <h2 className="text-sm font-semibold text-zinc-100">问答范围</h2>
        <p className="mt-1 text-xs text-zinc-400">
          范围由服务端确认：可以问项目内全部已就绪的会议，或只问指定的会议。
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="scope-project">项目</Label>
        {projectsLoading ? (
          <LoadingBlock label="正在读取项目…" />
        ) : (
          <select
            id="scope-project"
            value={selectedProjectId}
            onChange={(event) => onSelectProject(event.target.value)}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">请选择项目</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-zinc-200">范围模式</legend>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-300">
          <input
            type="radio"
            name="scope-mode"
            value="all_ready"
            checked={mode === 'all_ready'}
            onChange={() => onModeChange('all_ready')}
            className="h-4 w-4 accent-zinc-900 dark:accent-accent-base"
          />
          全部已就绪会议（{readyMeetings.length} 场）
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-300">
          <input
            type="radio"
            name="scope-mode"
            value="explicit"
            checked={mode === 'explicit'}
            onChange={() => onModeChange('explicit')}
            className="h-4 w-4 accent-zinc-900 dark:accent-accent-base"
          />
          指定会议（已选 {selectedDocumentIds.length} 场）
        </label>
      </fieldset>

      {mode === 'explicit' && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-zinc-400">选择会议</span>
            <button
              type="button"
              onClick={onClearDocuments}
              className="text-xs text-zinc-400 underline underline-offset-2 hover:text-zinc-200 focus:outline-none focus:ring-2 focus:ring-accent-base"
            >
              清空选择
            </button>
          </div>

          {meetingsLoading ? (
            <LoadingBlock label="正在读取会议…" />
          ) : meetings.length === 0 ? (
            <p className="text-xs text-zinc-500">
              该项目还没有会议记录，请先在「会议」页面导入。
            </p>
          ) : (
            <ul className="max-h-64 space-y-1 overflow-y-auto">
              {meetings.map((meeting) => {
                const disabled = meeting.status !== 'ready';
                const checked = selectedDocumentIds.includes(
                  meeting.document_id
                );
                return (
                  <li
                    key={meeting.document_id}
                    className="flex items-start gap-2 rounded px-1 py-1"
                  >
                    <Checkbox
                      id={`scope-${meeting.document_id}`}
                      checked={checked}
                      disabled={disabled}
                      onCheckedChange={() =>
                        onToggleDocument(meeting.document_id)
                      }
                      className="mt-0.5"
                    />
                    <Label
                      htmlFor={`scope-${meeting.document_id}`}
                      className={`flex-1 cursor-pointer text-xs ${
                        disabled ? 'text-zinc-500' : 'text-zinc-200'
                      }`}
                    >
                      <span className="block truncate">{meeting.title}</span>
                      <span className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-zinc-500">
                        {meeting.meeting_date || '日期未记录'}
                        <RecordKindBadge kind={meeting.record_kind} />
                        <MeetingStatusBadge status={meeting.status} />
                      </span>
                    </Label>
                  </li>
                );
              })}
            </ul>
          )}

          {mode === 'explicit' && selectedDocumentIds.length === 0 && (
            <p className="text-xs text-amber-300">
              指定会议模式至少需要选择一场已就绪的会议。
            </p>
          )}
        </div>
      )}
    </section>
  );
}

export default ScopePicker;
