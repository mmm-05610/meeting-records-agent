import { MessageSquare, NotebookPen, Users } from 'lucide-react';
import Link from 'next/link';
import React from 'react';

import Layout from '@/components/Layout';

const ENTRIES = [
  {
    href: '/documents',
    icon: NotebookPen,
    title: '会议',
    description:
      '按项目导入会议记录，查看标题、会议日期、记录类型、参与人与真实处理状态，并可删除会议。',
  },
  {
    href: '/chat',
    icon: MessageSquare,
    title: '问答',
    description:
      '选择项目与范围后提问，回答会显示进度、结论与可点击的原文引用，刷新后可恢复历史线程。',
  },
  {
    href: '/collections',
    icon: Users,
    title: '项目',
    description:
      '管理项目：项目是会议记录的隔离单位，问答范围以项目为单位由服务端确认。',
  },
];

const HomePage: React.FC = () => {
  return (
    <Layout pageTitle="工作台" includeFooter={false}>
      <main className="w-full flex flex-col container h-screen-[calc(100%-4rem)] overflow-y-auto">
        <div className="mx-auto w-full max-w-4xl py-10">
          <header className="mb-8">
            <h1 className="text-2xl font-bold text-white">会议记录助手</h1>
            <p className="mt-2 text-sm text-zinc-400">
              导入会议记录，在指定范围内提问，并逐条核对回答引用的原文。
            </p>
          </header>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {ENTRIES.map((entry) => {
              const Icon = entry.icon;
              return (
                <Link
                  key={entry.href}
                  href={entry.href}
                  className="group flex flex-col rounded-md border border-zinc-800 bg-zinc-950/40 p-5 transition-colors hover:border-accent-base/60 focus:outline-none focus:ring-2 focus:ring-accent-base"
                >
                  <Icon className="h-6 w-6 text-accent-base" />
                  <h2 className="mt-3 text-base font-semibold text-zinc-100 group-hover:text-white">
                    {entry.title}
                  </h2>
                  <p className="mt-2 text-xs leading-5 text-zinc-400">
                    {entry.description}
                  </p>
                </Link>
              );
            })}
          </div>
        </div>
      </main>
    </Layout>
  );
};

export default HomePage;
