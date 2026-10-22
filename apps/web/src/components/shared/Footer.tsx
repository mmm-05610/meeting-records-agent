'use client';

import Link from 'next/link';

import { brandingConfig } from '@/config/brandingConfig';

function SmallPrint() {
  return (
    <div className="flex flex-col items-center justify-between gap-2 border-t border-white/5 py-4 sm:flex-row">
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        &copy; {new Date().getFullYear()} {brandingConfig.companyName}
        。本机单账号使用，演示数据均为模拟会议记录。
      </p>
      <Link
        href="/"
        className="text-xs text-zinc-500 underline underline-offset-2 hover:text-zinc-300 focus:outline-none focus:ring-2 focus:ring-accent-base dark:text-zinc-400"
      >
        会议记录助手
      </Link>
    </div>
  );
}

function UpstreamNotice() {
  return (
    <p className="max-w-3xl text-[11px] leading-5 text-zinc-500 dark:text-zinc-400">
      {brandingConfig.upstreamNotice}
    </p>
  );
}

export function Footer() {
  return (
    <footer className="w-full flex flex-col container space-y-3">
      <UpstreamNotice />
      <SmallPrint />
    </footer>
  );
}

export default Footer;
