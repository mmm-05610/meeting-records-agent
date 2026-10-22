import { LogOut, UserRound } from 'lucide-react';
import { useRouter } from 'next/router';
import React, { useEffect, useState } from 'react';

import Layout from '@/components/Layout';
import { fetchSession } from '@/components/meeting/api';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/use-toast';
import { useUserContext } from '@/context/UserContext';

/**
 * 个人账户（次级入口）。
 *
 * v0.1 为本机单账号：只展示当前账号信息与退出登录，
 * 不提供昵称、头像等需要后端写入的设置项。
 */
const AccountPage: React.FC = () => {
  const router = useRouter();
  const { toast } = useToast();
  const { logout } = useUserContext();
  const [email, setEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchSession().then((session) => {
      if (cancelled) {
        return;
      }
      setEmail(session.user?.email ?? null);
      setUserId(session.user?.id ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleLogout = async () => {
    await logout();
    toast({ title: '已退出登录' });
    router.push('/auth/login');
  };

  return (
    <Layout pageTitle="个人账户">
      <main className="w-full flex flex-col container h-screen-[calc(100%-4rem)] overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl py-8">
          <header className="mb-6">
            <h1 className="text-xl font-bold text-white">个人账户</h1>
            <p className="mt-1 text-sm text-zinc-400">
              本机单账号使用：这里只显示当前登录的账号。
            </p>
          </header>

          <section className="space-y-4 rounded-md border border-zinc-800 bg-zinc-950/40 p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-800">
                <UserRound className="h-5 w-5 text-zinc-300" aria-hidden />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-zinc-100">
                  {email ?? '本地账号'}
                </p>
                <p className="truncate font-mono text-xs text-zinc-500">
                  {userId ?? '—'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Button
                color="secondary"
                shape="outline"
                onClick={() => void handleLogout()}
                aria-label="退出登录"
              >
                <LogOut className="mr-2 h-4 w-4" />
                退出登录
              </Button>
              <p className="text-xs text-zinc-500">
                退出后需要重新登录本机账号。
              </p>
            </div>
          </section>
        </div>
      </main>
    </Layout>
  );
};

export default AccountPage;
