import { Settings } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { forwardRef, useEffect, useState, ReactNode } from 'react';

import { Logo } from '@/components/shared/Logo';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/Button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { brandingConfig } from '@/config/brandingConfig';
import { useUserContext } from '@/context/UserContext';
import { NavbarProps } from '@/types';

interface NavItemProps {
  href: string;
  children: ReactNode;
  isActive: boolean;
}

const NavItem: React.FC<NavItemProps> = ({ href, children, isActive }) => (
  <Link
    href={href}
    aria-current={isActive ? 'page' : undefined}
    className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-accent-base ${
      isActive
        ? 'bg-accent-base/15 text-white'
        : 'text-zinc-300 hover:bg-zinc-800/70 hover:text-white'
    }`}
  >
    {children}
  </Link>
);

/** 主流程导航：项目 / 会议记录 / 问答。 */
const PRIMARY_ITEMS = [
  { path: '/collections', label: '项目' },
  { path: '/documents', label: '会议记录' },
  { path: '/chat', label: '问答' },
];

/** 次级入口：后台配置，不与主流程并列。 */
const SECONDARY_ITEMS = [
  { path: '/users', label: '用户管理' },
  { path: '/settings', label: '系统设置' },
  { path: '/account', label: '个人账户' },
];

export const Navbar = forwardRef<React.ElementRef<'nav'>, NavbarProps>(
  function Header({ className }, ref) {
    const router = useRouter();
    const { logout, isAuthenticated, authState, isSuperUser } =
      useUserContext();
    const [isSignedIn, setIsSignedIn] = useState(false);

    useEffect(() => {
      setIsSignedIn(isAuthenticated);
    }, [isAuthenticated]);

    const pathname = router.pathname;
    const handleLogout = async () => {
      await logout();
      router.push('/auth/login');
    };

    return (
      <nav
        ref={ref}
        className="bg-zinc-900 shadow z-50 w-full border-b border-zinc-800"
        aria-label="主导航"
      >
        <div className="w-full px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-14 items-center">
            <div className="flex items-center space-x-3 min-w-0">
              <Link
                href={isSuperUser() ? '/' : '/documents'}
                className="flex-shrink-0 flex items-center gap-2 rounded focus:outline-none focus:ring-2 focus:ring-accent-base"
                aria-label={`${brandingConfig.navbar.appName} 首页`}
              >
                <Logo className="h-7 w-7" disableLink={true} />
                <span className="text-base font-bold text-white sm:text-lg">
                  {brandingConfig.navbar.appName}
                </span>
              </Link>

              {isSignedIn && (
                <nav
                  className="hidden items-center gap-1 sm:flex"
                  aria-label="主流程"
                >
                  {PRIMARY_ITEMS.map((item) => (
                    <NavItem
                      key={item.path}
                      href={item.path}
                      isActive={pathname === item.path}
                    >
                      {item.label}
                    </NavItem>
                  ))}
                </nav>
              )}
            </div>

            <div className="flex items-center space-x-2">
              {isSignedIn && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      color="transparent"
                      shape="rounded"
                      className="px-2 py-1.5 text-xs"
                      aria-label="更多设置"
                    >
                      <Settings className="mr-1.5 h-4 w-4" />
                      <span className="hidden sm:inline">设置</span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel>次级入口</DropdownMenuLabel>
                    {SECONDARY_ITEMS.map((item) => (
                      <DropdownMenuItem
                        key={item.path}
                        className="cursor-pointer"
                        onClick={() => router.push(item.path)}
                      >
                        {item.label}
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="cursor-pointer"
                      onClick={handleLogout}
                    >
                      退出登录
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}

              {isSignedIn && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Avatar
                      className="cursor-pointer"
                      aria-label={`账号菜单（${authState.email ?? '本地账号'}）`}
                    >
                      <AvatarImage src="/images/default_profile.svg" />
                      <AvatarFallback></AvatarFallback>
                    </Avatar>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel>
                      {authState.email ?? '本地账号'}
                    </DropdownMenuLabel>
                    <DropdownMenuItem
                      className="cursor-pointer"
                      onClick={() => router.push('/account')}
                    >
                      个人账户
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="cursor-pointer"
                      onClick={handleLogout}
                    >
                      退出登录
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>

          {isSignedIn && (
            <nav
              className="flex items-center gap-1 overflow-x-auto pb-2 sm:hidden"
              aria-label="主流程（窄屏）"
            >
              {PRIMARY_ITEMS.map((item) => (
                <NavItem
                  key={item.path}
                  href={item.path}
                  isActive={pathname === item.path}
                >
                  {item.label}
                </NavItem>
              ))}
            </nav>
          )}
        </div>
      </nav>
    );
  }
);

Navbar.displayName = 'Navbar';
