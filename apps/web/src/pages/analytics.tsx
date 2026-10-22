import { BarChart3 } from 'lucide-react';
import React from 'react';

import Layout from '@/components/Layout';

/**
 * 用量分析（次级入口）。
 *
 * 本机单账号版本不收集用量指标，也不做多租户统计；
 * 保留该路径只是为了说明「没有这类看板」，避免再出现上游风格的仪表盘。
 */
const Analytics: React.FC = () => {
  return (
    <Layout pageTitle="用量分析">
      <main className="w-full flex flex-col container h-screen-[calc(100%-4rem)] overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl py-8">
          <header className="mb-6">
            <h1 className="text-xl font-bold text-white">用量分析</h1>
            <p className="mt-1 text-sm text-zinc-400">
              本机单账号版本不收集用量指标，这个页面暂时没有内容。
            </p>
          </header>

          <section className="flex items-start gap-3 rounded-md border border-zinc-800 bg-zinc-950/40 p-4">
            <BarChart3
              className="mt-0.5 h-5 w-5 shrink-0 text-zinc-500"
              aria-hidden
            />
            <p className="text-xs leading-5 text-zinc-400">
              回答与引用的核对请在「问答」页完成：展开「查看来源」与「查看核对详情」即可看到每条引用对应的会议原文与覆盖情况。
            </p>
          </section>
        </div>
      </main>
    </Layout>
  );
};

export default Analytics;
