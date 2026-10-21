'use client';

import { FolderPlus } from 'lucide-react';
import React, { useState } from 'react';

import {
  MeetingApiError,
  createProject,
  type ProjectSummary,
} from '@/components/meeting/api';
import { EmptyBlock, LoadingBlock } from '@/components/meeting/empty-state';
import { ErrorNotice } from '@/components/meeting/error-notice';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export interface ProjectListProps {
  projects: ProjectSummary[];
  loading: boolean;
  error: MeetingApiError | null;
  selectedProjectId: string;
  onSelect: (projectId: string) => void;
  onCreated?: (project: ProjectSummary) => void;
  onRefresh?: () => void;
  emptyDescription?: string;
}

/** 项目列表与创建（调用同源 `/api/projects`）。 */
export function ProjectList({
  projects,
  loading,
  error,
  selectedProjectId,
  onSelect,
  onCreated,
  onRefresh,
  emptyDescription = '先新建一个项目，再往里面导入会议记录。',
}: ProjectListProps): JSX.Element {
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<MeetingApiError | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);

  const handleCreate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError('请填写项目名称。');
      return;
    }
    setNameError(null);
    setCreating(true);
    setCreateError(null);
    try {
      const project = await createProject(trimmed, description.trim());
      setCreateOpen(false);
      setName('');
      setDescription('');
      onCreated?.(project);
    } catch (submitError) {
      const apiError =
        submitError instanceof MeetingApiError
          ? submitError
          : new MeetingApiError({
              category: 'service_failure',
              message: '创建项目失败，请稍后重试。',
              retryable: true,
            });
      setCreateError(apiError);
      if (apiError.fields.includes('name')) {
        setNameError(apiError.message);
      }
    } finally {
      setCreating(false);
    }
  };

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-zinc-100">项目</h2>
        <div className="flex items-center gap-1">
          {onRefresh && (
            <Button
              color="transparent"
              shape="rounded"
              className="px-2 py-1 text-xs"
              onClick={onRefresh}
              disabled={loading}
            >
              刷新
            </Button>
          )}
          <Button
            color="transparent"
            shape="rounded"
            className="px-3 py-1.5 text-xs"
            onClick={() => setCreateOpen((open) => !open)}
          >
            <FolderPlus className="mr-1.5 h-3.5 w-3.5" />
            新建项目
          </Button>
        </div>
      </div>

      <ErrorNotice error={error} onRetry={onRefresh} />

      {createOpen && (
        <form
          onSubmit={handleCreate}
          className="space-y-3 rounded-md border border-zinc-800 bg-zinc-950/40 p-4"
        >
          <ErrorNotice error={createError} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="project-name">项目名称</Label>
              <Input
                id="project-name"
                value={name}
                placeholder="例如：2026 春季研发例会"
                onChange={(event) => {
                  setName(event.target.value);
                  setNameError(null);
                }}
              />
              {nameError && <p className="text-xs text-red-400">{nameError}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="project-description">项目说明（可选）</Label>
              <Input
                id="project-description"
                value={description}
                placeholder="这个项目收录哪些会议"
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              type="submit"
              color="filled"
              shape="rounded"
              className="px-4 py-2"
              disabled={creating}
            >
              {creating ? '创建中…' : '创建项目'}
            </Button>
            <Button
              type="button"
              color="transparent"
              shape="rounded"
              className="px-3 py-2"
              onClick={() => setCreateOpen(false)}
            >
              取消
            </Button>
          </div>
        </form>
      )}

      {loading ? (
        <LoadingBlock label="正在读取项目…" />
      ) : projects.length === 0 ? (
        <EmptyBlock
          title="还没有项目"
          description={emptyDescription}
          action={
            <Button
              color="filled"
              shape="rounded"
              className="px-4 py-2"
              onClick={() => setCreateOpen(true)}
            >
              新建项目
            </Button>
          }
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          {projects.map((project) => {
            const active = project.id === selectedProjectId;
            return (
              <button
                key={project.id}
                type="button"
                onClick={() => onSelect(project.id)}
                aria-pressed={active}
                className={`rounded-md border px-3 py-2 text-left text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-accent-base ${
                  active
                    ? 'border-accent-base bg-accent-base/10 text-white'
                    : 'border-zinc-800 bg-zinc-950/40 text-zinc-300 hover:border-zinc-700'
                }`}
              >
                <span className="block font-medium">{project.name}</span>
                {project.description && (
                  <span className="block text-xs text-zinc-500">
                    {project.description}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default ProjectList;
