import { MessageSquare } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import React, { useCallback, useEffect, useState } from 'react';

import Layout from '@/components/Layout';
import {
  MeetingApiError,
  deleteMeeting,
  fetchProjectMeetings,
  fetchProjects,
  type MeetingSummary,
  type ProjectSummary,
} from '@/components/meeting/api';
import { DeleteMeetingDialog } from '@/components/meeting/delete-meeting-dialog';
import { EmptyBlock, LoadingBlock } from '@/components/meeting/empty-state';
import { ErrorNotice } from '@/components/meeting/error-notice';
import { MeetingTable } from '@/components/meeting/meeting-table';
import { UploadForm } from '@/components/meeting/upload-form';
import { useToast } from '@/components/ui/use-toast';

const ProjectDetailPage: React.FC = () => {
  const router = useRouter();
  const { toast } = useToast();

  const projectId = typeof router.query.id === 'string' ? router.query.id : '';

  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [projectsError, setProjectsError] = useState<MeetingApiError | null>(
    null
  );

  const [meetings, setMeetings] = useState<MeetingSummary[]>([]);
  const [meetingsLoading, setMeetingsLoading] = useState(false);
  const [meetingsError, setMeetingsError] = useState<MeetingApiError | null>(
    null
  );

  const [deleteTarget, setDeleteTarget] = useState<MeetingSummary | null>(null);

  const loadProject = useCallback(async () => {
    if (!projectId) {
      return;
    }
    setProjectsLoading(true);
    setProjectsError(null);
    try {
      const list = await fetchProjects();
      setProject(list.find((item) => item.id === projectId) ?? null);
    } catch (error) {
      setProject(null);
      setProjectsError(
        error instanceof MeetingApiError
          ? error
          : new MeetingApiError({
              category: 'service_failure',
              message: '读取项目失败，请稍后重试。',
              retryable: true,
            })
      );
    } finally {
      setProjectsLoading(false);
    }
  }, [projectId]);

  const loadMeetings = useCallback(async () => {
    if (!projectId) {
      setMeetings([]);
      return;
    }
    setMeetingsLoading(true);
    setMeetingsError(null);
    try {
      const list = await fetchProjectMeetings(projectId, 'all');
      setMeetings(list);
    } catch (error) {
      setMeetings([]);
      setMeetingsError(
        error instanceof MeetingApiError
          ? error
          : new MeetingApiError({
              category: 'service_failure',
              message: '读取会议列表失败，请稍后重试。',
              retryable: true,
            })
      );
    } finally {
      setMeetingsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (!router.isReady) {
      return;
    }
    void loadProject();
  }, [loadProject, router.isReady]);

  useEffect(() => {
    if (!router.isReady) {
      return;
    }
    void loadMeetings();
  }, [loadMeetings, router.isReady]);

  return (
    <Layout pageTitle={project ? project.name : '项目'} includeFooter={false}>
      <main className="w-full flex flex-col container h-screen-[calc(100%-4rem)] overflow-y-auto">
        <div className="mx-auto w-full max-w-5xl py-6">
          <header className="mb-6">
            <Link
              href="/collections"
              className="text-xs text-zinc-400 underline underline-offset-2 hover:text-zinc-200 focus:outline-none focus:ring-2 focus:ring-accent-base"
            >
              返回项目列表
            </Link>
            <h1 className="mt-2 text-xl font-bold text-white">
              {projectsLoading ? '加载中…' : (project?.name ?? '未找到该项目')}
            </h1>
            {project?.description && (
              <p className="mt-1 text-sm text-zinc-400">
                {project.description}
              </p>
            )}
          </header>

          <ErrorNotice error={projectsError} onRetry={loadProject} />

          {projectsLoading ? (
            <LoadingBlock label="正在读取项目…" />
          ) : !project && !projectsError ? (
            <EmptyBlock
              title="未找到该项目"
              description="该项目可能已被删除，请返回项目列表重新选择。"
            />
          ) : (
            <div className="space-y-6">
              <div className="flex justify-end">
                <Link
                  href={`/chat?project=${encodeURIComponent(projectId)}`}
                  className="inline-flex items-center rounded-md px-3 py-1.5 text-xs text-accent-base underline underline-offset-2 hover:text-accent-light focus:outline-none focus:ring-2 focus:ring-accent-base"
                >
                  <MessageSquare className="mr-1.5 h-3.5 w-3.5" />
                  就该项目提问
                </Link>
              </div>

              <MeetingTable
                meetings={meetings}
                loading={meetingsLoading}
                error={meetingsError}
                onRefresh={() => void loadMeetings()}
                onDelete={(meeting) => setDeleteTarget(meeting)}
              />

              <p className="text-xs text-zinc-500">
                只有「已就绪」的会议会进入问答范围；处理中或失败的记录需要重新导入。
              </p>

              <UploadForm
                projectId={projectId}
                onUploaded={() => {
                  void loadMeetings();
                }}
              />
            </div>
          )}
        </div>
      </main>

      <DeleteMeetingDialog
        meeting={deleteTarget}
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
          }
        }}
        onConfirm={async (meeting) => deleteMeeting(meeting.document_id)}
        onDeleted={(meeting) => {
          toast({
            title: '会议已删除',
            description: `「${meeting.title}」已从项目中移除。`,
          });
          void loadMeetings();
        }}
      />
    </Layout>
  );
};

export default ProjectDetailPage;
