import { Info, ShieldCheck } from 'lucide-react';
import React from 'react';

import Layout from '@/components/Layout';
import { brandingConfig } from '@/config/brandingConfig';

/**
 * 系统设置（次级入口）。
 *
 * 本机单账号版本没有需要在线修改的运行参数，这里只展示产品信息、
 * 数据位置与许可说明；不提供上游控制台的配置入口。
 */
const SettingsPage: React.FC = () => {
  return (
    <Layout pageTitle="系统设置">
      <main className="w-full flex flex-col container h-screen-[calc(100%-4rem)] overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl py-8">
          <header className="mb-6">
            <h1 className="text-xl font-bold text-white">系统设置</h1>
            <p className="mt-1 text-sm text-zinc-400">
              本机单账号版本没有需要在线修改的运行参数，以下为当前部署信息。
            </p>
          </header>

          <section className="space-y-3 rounded-md border border-zinc-800 bg-zinc-950/40 p-4">
            <dl className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
              <div>
                <dt className="text-zinc-500">产品名称</dt>
                <dd className="text-zinc-100">{brandingConfig.productName}</dd>
              </div>
              <div>
                <dt className="text-zinc-500">版本</dt>
                <dd className="text-zinc-100">v0.1.1</dd>
              </div>
              <div>
                <dt className="text-zinc-500">运行方式</dt>
                <dd className="text-zinc-100">本机单账号，仅监听 127.0.0.1</dd>
              </div>
              <div>
                <dt className="text-zinc-500">数据位置</dt>
                <dd className="text-zinc-100">
                  本机 PostgreSQL（含会议记录与回答历史）
                </dd>
              </div>
            </dl>
          </section>

          <section className="mt-4 space-y-3 rounded-md border border-zinc-800 bg-zinc-950/40 p-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
              <ShieldCheck className="h-4 w-4 text-accent-base" aria-hidden />
              许可与来源
            </h2>
            <p className="text-xs leading-5 text-zinc-400">
              {brandingConfig.upstreamNotice}
            </p>
          </section>

          <section className="mt-4 space-y-3 rounded-md border border-zinc-800 bg-zinc-950/40 p-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
              <Info className="h-4 w-4 text-accent-base" aria-hidden />
              使用说明
            </h2>
            <ul className="space-y-1 text-xs leading-5 text-zinc-400">
              <li>1. 在「会议记录」页导入会议记录文件（支持一次选择多个）。</li>
              <li>2. 在「问答」页选择项目与范围，再提出问题。</li>
              <li>3. 点击回答中的编号引用，查看对应的原文片段。</li>
              <li>4. 使用说明与演示步骤见仓库中的 docs/usage/demo.md。</li>
            </ul>
          </section>
        </div>
      </main>
    </Layout>
  );
};

export default SettingsPage;
