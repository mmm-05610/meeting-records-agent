// src/config/brandingConfig.ts

import brandingOverride from './brandingOverride';

/**
 * 会议记录助手 —— 品牌配置。
 *
 * 页面所有可见文案只使用这里的产品名；上游（SciPhi-AI/R2R 等）只作为
 * 许可说明出现在页脚，不出现在导航、标题与功能入口中。
 */
const defaultConfig = {
  companyName: '会议记录助手',
  deploymentName: '会议记录助手',
  productName: '会议记录助手',
  productTagline: '导入会议记录，在指定范围内提问，并逐条核对引用原文。',
  socialLinks: {
    twitter: { enabled: false, url: '' },
    github: { enabled: false, url: '' },
    discord: { enabled: false, url: '' },
  },
  navbar: {
    appName: '会议记录助手',
    showDocsButton: false,
    menuItems: {
      home: false,
      documents: true,
      collections: true,
      chat: true,
      search: false,
      users: true,
      logs: false,
      analytics: false,
      settings: true,
    },
  },
  logo: {
    src: '/images/sciphi.svg',
    alt: '会议记录助手',
  },
  theme: 'dark',
  homePage: {
    pythonSdk: false,
    githubCard: false,
    hatchetCard: false,
  },
  nextConfig: {
    additionalRemoteDomain: '',
  },
  /** 页脚中的上游许可说明（中文，不出现开发者品牌入口）。 */
  upstreamNotice:
    '本产品基于开源项目二次开发：文档与检索服务基于 SciPhi-AI/R2R（MIT），' +
    'Agent 服务基于 agent-service-toolkit（MIT），Web 界面基于 R2R-Application（MIT）。' +
    '本项目以 MIT 许可发布。',
};

// ✅ Declare `window.__BRANDING_CONFIG__` globally to avoid TypeScript errors
declare global {
  interface Window {
    __BRANDING_CONFIG__?: Partial<typeof defaultConfig>;
  }
}

// ✅ Load user-defined config from `window.__BRANDING_CONFIG__` (if available)
const userConfig =
  (typeof window !== 'undefined' && window.__BRANDING_CONFIG__) || {};

// ✅ Merge `defaultConfig`, `brandingOverride.ts`, and `userConfig`
export const brandingConfig = {
  ...defaultConfig,
  ...brandingOverride,
  ...userConfig,
};
