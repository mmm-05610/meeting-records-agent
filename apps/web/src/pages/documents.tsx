import { MessageSquare } from 'lucide-react';
import Link from 'next/link';
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
import { ErrorNotice } from '@/components/meeting/error-notice';
import { MeetingTable } from '@/components/meeting/meeting-table';
import { ProjectList } from '@/components/meeting/project-list';
import { UploadForm } from '@/components/meeting/upload-form';
import { useToast } from '@/components/ui/use-toast';

const DocumentsPage: React.FC = () => {
  const { toast } = useToast();

  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [projectsError, setProjectsError] = useState<MeetingApiError | null>(
    null
  );

  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [meetings, setMeetings] = useState<MeetingSummary[]>([]);
  const [meetingsLoading, setMeetingsLoading] = useState(false);
  const [meetingsError, setMeetingsError] = useState<MeetingApiError | null>(
    null
  );

  const [deleteTarget, setDeleteTarget] = useState<MeetingSummary | null>(null);

  const loadProjects = useCallback(async () => {
    setProjectsLoading(true);
    setProjectsError(null);
    try {
      const list = await fetchProjects();
      setProjects(list);
      setSelectedProjectId((current) => {
        if (current && list.some((project) => project.id === current)) {
          return current;
        }
        return list[0]?.id ?? '';
      });
    } catch (error) {
      setProjects([]);
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
  }, []);

  const loadMeetings = useCallback(async (projectId: string) => {
    if (!projectId) {
      setMeetings([]);
      setMeetingsError(null);
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
  }, []);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    void loadMeetings(selectedProjectId);
  }, [loadMeetings, selectedProjectId]);

  const handleDelete = useCallback(async (meeting: MeetingSummary) => {
    return deleteMeeting(meeting.document_id);
  }, []);

  const handleDeleted = useCallback(
    (meeting: MeetingSummary) => {
      toast({
        title: '会议已删除',
        description: `「${meeting.title}」已从项目中移除。`,
      });
      void loadMeetings(selectedProjectId);
    },
    [loadMeetings, selectedProjectId, toast]
  );

  const selectedProject = projects.find(
    (project) => project.id === selectedProjectId
  );

  return (
    <Layout pageTitle="会议" includeFooter={false}>
      <main className="w-full flex flex-col container h-screen-[calc(100%-4rem)] overflow-y-auto">
        <div className="mx-auto w-full max-w-5xl py-6">
          <header className="mb-6">
            <h1 className="text-xl font-bold text-white">会议记录</h1>
            <p className="mt-1 text-sm text-zinc-400">
              按项目管理会议记录：导入记录、查看真实处理状态，并在需要时删除记录。
            </p>
          </header>

          <ErrorNotice error={projectsError} onRetry={loadProjects} />
          {projectsError?.status === 401 && (
            <p className="mt-2 text-sm text-zinc-300">
              需要先登录才能查看项目。
              <Link
                href="/auth/login"
                className="ml-2 underline underline-offset-2 hover:text-white"
              >
                前往登录
              </Link>
            </p>
          )}

          <section className="mt-4 space-y-3">
            <ProjectList
              projects={projects}
              loading={projectsLoading}
              error={projectsError}
              selectedProjectId={selectedProjectId}
              onSelect={setSelectedProjectId}
              onRefresh={loadProjects}
              onCreated={(project) => {
                if (project?.id) {
                  setSelectedProjectId(project.id);
                }
                void loadProjects();
                toast({
                  title: '项目已创建',
                  description: `项目「${project?.name ?? ''}」已创建。`,
                });
              }}
            />
          </section>

          {selectedProject && (
            <section className="mt-8 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-zinc-100">
                  {selectedProject.name} · 会议
                </h2>
                <Link
                  href={`/chat?project=${encodeURIComponent(
                    selectedProject.id
                  )}`}
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
                onRefresh={() => void loadMeetings(selectedProjectId)}
                onDelete={(meeting) => setDeleteTarget(meeting)}
              />

              <p className="text-xs text-zinc-500">
                只有「已就绪」的会议会进入问答范围；处理中或失败的记录需要重新导入。
              </p>

              <UploadForm
                projectId={selectedProject.id}
                onUploaded={() => {
                  void loadMeetings(selectedProject.id);
                }}
              />
            </section>
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
        onConfirm={handleDelete}
        onDeleted={handleDeleted}
      />
    </Layout>
  );
};

export default DocumentsPage;
