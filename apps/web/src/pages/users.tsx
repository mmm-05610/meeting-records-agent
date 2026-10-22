import { ShieldCheck, UserRound } from 'lucide-react';
import React, { useEffect, useState } from 'react';

import Layout from '@/components/Layout';
import { fetchSession } from '@/components/meeting/api';
import { useUserContext } from '@/context/UserContext';

/**
 * 用户管理（次级入口）。
 *
 * v0.1 为本机单账号产品：没有多用户体系，这里只说明当前账号，
 * 不提供邀请、角色或删除其他账号的能力。
 */
const UsersPage: React.FC = () => {
  const { authState } = useUserContext();
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchSession().then((session) => {
      if (!cancelled) {
        setEmail(session.user?.email ?? null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Layout pageTitle="用户管理">
      <main className="w-full flex flex-col container h-screen-[calc(100%-4rem)] overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl py-8">
          <header className="mb-6">
            <h1 className="text-xl font-bold text-white">用户管理</h1>
            <p className="mt-1 text-sm text-zinc-400">
              当前版本是本机单账号使用，暂不提供多用户管理。
            </p>
          </header>

          <section className="space-y-4 rounded-md border border-zinc-800 bg-zinc-950/40 p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-800">
                <UserRound className="h-5 w-5 text-zinc-300" aria-hidden />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-zinc-100">
                  {email ?? authState.email ?? '本地账号'}
                </p>
                <p className="text-xs text-zinc-500">当前登录账号</p>
              </div>
            </div>

            <p className="flex items-start gap-2 rounded-md border border-zinc-800 bg-zinc-950/60 p-3 text-xs text-zinc-400">
              <ShieldCheck
                className="mt-0.5 h-4 w-4 shrink-0 text-accent-base"
                aria-hidden
              />
              账号与会议记录都保存在本机，不提供邀请成员、角色权限或账号迁移功能。
            </p>
          </section>
        </div>
      </main>
    </Layout>
  );
};

export default UsersPage;
