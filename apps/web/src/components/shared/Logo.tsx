import Link from 'next/link';
import React from 'react';

import { brandingConfig } from '@/config/brandingConfig';

interface LogoProps {
  width?: number;
  height?: number;
  className?: string;
  onClick?: () => void;
  disableLink?: boolean;
}

/**
 * 产品标记：会议记录助手（内联 SVG，不引用任何上游品牌素材）。
 */
export function Logo({
  width = 28,
  height = 28,
  className = '',
  onClick,
  disableLink = false,
}: LogoProps): JSX.Element {
  const handleClick = (e: React.MouseEvent<HTMLElement, MouseEvent>) => {
    if (onClick) {
      e.preventDefault();
      onClick();
    }
  };

  const mark = (
    <svg
      viewBox="0 0 32 32"
      width={width}
      height={height}
      className={className}
      role="img"
      aria-label={brandingConfig.logo.alt}
      focusable="false"
    >
      <rect
        x="1.5"
        y="1.5"
        width="29"
        height="29"
        rx="8"
        className="fill-accent-base/15 stroke-accent-base"
        strokeWidth="1.5"
      />
      <path
        d="M9 9.5h14M9 14h14M9 18.5h9"
        className="stroke-accent-base"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <circle
        cx="22.5"
        cy="21"
        r="4"
        className="fill-accent-base/20 stroke-accent-base"
        strokeWidth="1.4"
      />
      <path
        d="M21 21.2l1 1 1.8-2"
        className="stroke-accent-base"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );

  const combinedClassName =
    `${className} ${disableLink ? 'cursor-default' : 'cursor-pointer'}`.trim();

  if (disableLink) {
    return (
      <div className={combinedClassName} onClick={handleClick}>
        {mark}
      </div>
    );
  }

  return (
    <Link href="/" className={combinedClassName}>
      <span onClick={handleClick}>{mark}</span>
    </Link>
  );
}

export default Logo;
