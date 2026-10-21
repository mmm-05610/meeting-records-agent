import { Eye, EyeOff } from 'lucide-react';
import { useRouter } from 'next/router';
import React, { useCallback, useEffect, useState } from 'react';

import Layout from '@/components/Layout';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/input';
import { useUserContext } from '@/context/UserContext';

const LoginPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const { login, authState } = useUserContext();
  const router = useRouter();

  useEffect(() => {
    if (authState.isAuthenticated) {
      void router.replace('/');
    }
  }, [authState.isAuthenticated, router]);

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      setError(null);
      if (!email.trim() || !password) {
        setError('请输入邮箱和密码。');
        return;
      }
      setIsLoading(true);
      try {
        await login(email.trim(), password, '');
        await router.replace('/');
      } catch (loginError) {
        setError(
          loginError instanceof Error
            ? loginError.message
            : '登录失败，请检查邮箱或密码。'
        );
      } finally {
        setIsLoading(false);
      }
    },
    [email, login, password, router]
  );

  return (
    <Layout includeFooter={false}>
      <div className="flex flex-col items-center justify-center min-h-screen p-8 gap-8">
        <div className="bg-zinc-100 dark:bg-zinc-800 shadow-md rounded px-8 pt-6 pb-8 w-full max-w-md">
          <h1 className="text-2xl font-bold mb-1 text-gray-800 dark:text-gray-100">
            会议记录问答助手
          </h1>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
            本地单账号登录。首个账号由部署者在本机初始化，本版本不提供注册入口。
          </p>
          <form onSubmit={handleSubmit}>
            <div className="mb-4">
              <label
                className="block text-gray-700 dark:text-gray-200 text-sm font-bold mb-2"
                htmlFor="email"
              >
                邮箱
              </label>
              <Input
                id="email"
                type="email"
                placeholder="owner@meeting-records.local"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                disabled={isLoading}
              />
            </div>
            <div className="mb-6">
              <label
                className="block text-gray-700 dark:text-gray-200 text-sm font-bold mb-2"
                htmlFor="password"
              >
                密码
              </label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="密码"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  disabled={isLoading}
                />
                <button
                  type="button"
                  aria-label={showPassword ? '隐藏密码' : '显示密码'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500"
                  onClick={() => setShowPassword((current) => !current)}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>
            {error && (
              <p className="text-red-500 text-sm mb-4" role="alert">
                {error}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? '正在登录…' : '登录'}
            </Button>
          </form>
        </div>
      </div>
    </Layout>
  );
};

export default LoginPage;
