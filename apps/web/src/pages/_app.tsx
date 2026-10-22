import type { AppProps } from 'next/app';
import { useRouter } from 'next/router';
import { useTheme } from 'next-themes';
import { useEffect, useCallback } from 'react';

import { ThemeProvider } from '@/components/ThemeProvider';
import { brandingConfig } from '@/config/brandingConfig';
import { UserProvider, useUserContext } from '@/context/UserContext';
import '@/styles/globals.css';

function MyAppContent({ Component, pageProps }: AppProps) {
  const { setTheme } = useTheme();
  const { isAuthenticated, isSuperUser, authState } = useUserContext();
  const router = useRouter();

  useEffect(() => {
    setTheme(brandingConfig.theme);
    // 上游 R2R 的 PostHog 遥测会把本机使用数据发到 SciPhi 的分析实例，
    // 属于开发者品牌痕迹；本产品为本机单账号使用，不再初始化该遥测。
  }, []);

  const checkAccess = useCallback(async () => {
    // v0.1 只有本地单账号：注册入口关闭，/auth/signup 不再是公开路由。
    const publicRoutes = ['/auth/login'];
    const userRoutes = [
      '/documents',
      '/collections',
      '/collection',
      '/chat',
      '/account',
    ];
    const currentPath = router.pathname;

    const isUserRoute = (path: string) => {
      return userRoutes.some((route) => path.startsWith(route));
    };

    if (!isAuthenticated) {
      if (!publicRoutes.includes(currentPath)) {
        router.replace('/auth/login');
      }
      return;
    }

    if (isSuperUser()) {
      return;
    }

    if (!isUserRoute(currentPath)) {
      router.replace('/documents');
    }
  }, [isAuthenticated, isSuperUser, authState.userRole, router]);

  useEffect(() => {
    checkAccess();
  }, [checkAccess]);

  return <Component {...pageProps} />;
}

function MyApp(props: AppProps) {
  // Move the runtime config check into useEffect
  useEffect(() => {
    // Load the env-config.js script dynamically
    const script = document.createElement('script');
    script.src = '/env-config.js';
    script.onload = () => {
      if (typeof window !== 'undefined' && window.__RUNTIME_CONFIG__) {
        console.log('Runtime Config:', window.__RUNTIME_CONFIG__);
      } else {
        console.warn('Runtime Config not found!');
      }
    };
    document.body.appendChild(script);
  }, []);

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem={false}
      disableTransitionOnChange
    >
      <UserProvider>
        <MyAppContent {...props} />
      </UserProvider>
    </ThemeProvider>
  );
}

export default MyApp;
