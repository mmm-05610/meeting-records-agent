import { MessageSquare, NotebookPen } from 'lucide-react';
import Link from 'next/link';
import React, { useCallback, useEffect, useState } from 'react';

import Layout from '@/components/Layout';
import {
  MeetingApiError,
  fetchProjects,
  type ProjectSummary,
} from '@/components/meeting/api';
import { EmptyBlock, LoadingBlock } from '@/components/meeting/empty-state';
import { ErrorNotice } from '@/components/meeting/error-notice';
import { ProjectList } from '@/components/meeting/project-list';

const CollectionsPage: React.FC = () => {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<MeetingApiError | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState('');

  const loadProjects = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await fetchProjects();
      setProjects(list);
      setSelectedProjectId((current) =>
        current && list.some((project) => project.id === current)
          ? current
          : (list[0]?.id ?? '')
      );
    } catch (loadError) {
      setProjects([]);
      setError(
        loadError instanceof MeetingApiError
          ? loadError
          : new MeetingApiError({
              category: 'service_failure',
              message: '读取项目失败，请稍后重试。',
              retryable: true,
            })
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  return (
    <Layout pageTitle="项目" includeFooter={false}>
      <main className="w-full flex flex-col container h-screen-[calc(100%-4rem)] overflow-y-auto">
        <div className="mx-auto w-full max-w-5xl py-6">
          <header className="mb-6">
            <h1 className="text-xl font-bold text-white">项目</h1>
            <p className="mt-1 text-sm text-zinc-400">
              项目用于隔离会议记录：每个项目拥有自己的会议集合，问答范围以项目为单位确认。
            </p>
          </header>

          <ProjectList
            projects={projects}
            loading={loading}
            error={error}
            selectedProjectId={selectedProjectId}
            onSelect={setSelectedProjectId}
            onRefresh={loadProjects}
          />

          <section className="mt-8 space-y-3">
            <h2 className="text-sm font-semibold text-zinc-100">项目详情</h2>
            {loading ? (
              <LoadingBlock label="正在读取项目…" />
            ) : projects.length === 0 ? (
              <EmptyBlock
                title="还没有项目"
                description="新建项目后即可导入会议记录并开始提问。"
              />
            ) : (
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {projects.map((project) => (
                  <li
                    key={project.id}
                    className="rounded-md border border-zinc-800 bg-zinc-950/40 p-4"
                  >
                    <h3 className="text-sm font-medium text-zinc-100">
                      {project.name}
                    </h3>
                    {project.description && (
                      <p className="mt-1 text-xs text-zinc-400">
                        {project.description}
                      </p>
                    )}
                    <div className="mt-3 flex flex-wrap gap-3 text-xs">
                      <Link
                        href={`/collections/${encodeURIComponent(project.id)}`}
                        className="inline-flex items-center text-accent-base underline underline-offset-2 hover:text-accent-light focus:outline-none focus:ring-2 focus:ring-accent-base"
                      >
                        <NotebookPen className="mr-1.5 h-3.5 w-3.5" />
                        查看会议
                      </Link>
                      <Link
                        href={`/chat?project=${encodeURIComponent(project.id)}`}
                        className="inline-flex items-center text-accent-base underline underline-offset-2 hover:text-accent-light focus:outline-none focus:ring-2 focus:ring-accent-base"
                      >
                        <MessageSquare className="mr-1.5 h-3.5 w-3.5" />
                        就该项目提问
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className="mt-8">
            <Link
              href="/documents"
              className="text-sm text-accent-base underline underline-offset-2 hover:text-accent-light focus:outline-none focus:ring-2 focus:ring-accent-base"
            >
              前往会议记录页面
            </Link>
          </div>

          {error && <ErrorNotice error={error} onRetry={loadProjects} />}
        </div>
      </main>
    </Layout>
  );
};

export default CollectionsPage;
