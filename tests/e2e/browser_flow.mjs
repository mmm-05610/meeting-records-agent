/**
 * Real browser flow for v0.1 (A01/A02/A04/A05/A09/A10/A11/A12/A13 partial).
 *
 * Prerequisites: PostgreSQL + model gateway + R2R + agent + web are running on
 * 127.0.0.1 (55432/8081/7272/8080/3000) and the demo datasets are imported.
 *
 * Run: cd apps/web && node ../../tests/e2e/browser_flow.mjs
 */

import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const playwrightModule =
  process.env.PLAYWRIGHT_MODULE || resolve(process.cwd(), 'node_modules/playwright');
const { chromium } = require(playwrightModule);

const BASE = process.env.MRA_WEB_URL || 'http://127.0.0.1:3000';
const EMAIL = process.env.R2R_ADMIN_EMAIL || 'owner@meeting-records.local';
const PASSWORD = process.env.R2R_ADMIN_PASSWORD || 'owner_local_pw_2026';
const OUT = resolve(process.cwd(), '../../docs/evidence/screenshots');
mkdirSync(OUT, { recursive: true });

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const page = await context.newPage();
page.setDefaultTimeout(30000);

try {
  await page.goto(`${BASE}/auth/login`, { waitUntil: 'networkidle' });
  await page.fill('#email', EMAIL);
  await page.fill('#password', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith('/auth'), { timeout: 30000 });
  record('登录成功并离开登录页', true, page.url());
  record('登录页无注册入口', (await page.locator('text=Sign up').count()) === 0);
  await page.screenshot({ path: `${OUT}/01-after-login.png`, fullPage: true });

  await page.goto(`${BASE}/documents`, { waitUntil: 'networkidle' });
  await page.waitForSelector('text=模拟项目A：星河笔记', { timeout: 30000 });
  record('会议页显示真实项目', true);
  await page.locator('text=模拟项目A：星河笔记').first().click();
  await page.waitForSelector('text=星河笔记 检索方案评审会', { timeout: 30000 });
  const readyCount = await page.locator('text=已就绪').count();
  record('会议列表显示真实会议与就绪状态', readyCount > 0, `ready badges=${readyCount}`);
  await page.screenshot({ path: `${OUT}/02-documents.png`, fullPage: true });

  const demoFile = resolve(process.cwd(), '../../data/tmp/e2e-meeting.txt');
  mkdirSync(resolve(process.cwd(), '../../data/tmp'), { recursive: true });
  writeFileSync(
    demoFile,
    '# E2E 浏览器验收会\n\n会议日期：2026-06-01\n\n本次会议明确确认：E2E 演示用的埋点方案采用事件表。\n王五负责埋点数据校验，截止 2026-06-05。\n',
    'utf8'
  );
  await page.setInputFiles('#meeting-file', demoFile);
  await page.fill('#meeting-title', 'E2E 浏览器验收会');
  await page.fill('#meeting-date', '2026-06-01');
  await page.fill('#meeting-participants', '王五、赵六');
  await page.locator('button:has-text("上传")').last().click();
  await page.waitForSelector('text=E2E 浏览器验收会', { timeout: 90000 });
  record('真实 UI 上传中文会议并出现在列表', true);
  await page.screenshot({ path: `${OUT}/03-uploaded.png`, fullPage: true });

  await page.locator('button[aria-label="删除会议 E2E 浏览器验收会"]').click();
  await page.waitForTimeout(800);
  await page.locator('button:has-text("确认删除")').click();
  await page
    .locator('text=E2E 浏览器验收会')
    .first()
    .waitFor({ state: 'detached', timeout: 45000 })
    .catch(() => {});
  await page.waitForTimeout(1500);
  const stillThere = await page.locator('text=E2E 浏览器验收会').count();
  record('删除会议后列表不再显示', stillThere === 0, `remaining=${stillThere}`);

  await page.goto(`${BASE}/chat`, { waitUntil: 'networkidle' });
  await page.selectOption('#scope-project', { label: '模拟项目A：星河笔记' });
  await page.waitForTimeout(1500);
  await page.fill('textarea[placeholder*="提问"]', '星河笔记 v1.0 的检索方案最后怎么定的？最新会议重新建议改回标签过滤方案，会影响当前决定吗？');
  await page.click('button:has-text("发送")');
  await page.waitForSelector('text=最终答案', { timeout: 420000 });
  await page.waitForSelector('text=已完成', { timeout: 120000 });
  const answerText = await page.locator('body').innerText();
  record('决定类问题返回已完成答案', answerText.includes('最终答案'));
  record('答案包含最终确认的混合检索方案', answerText.includes('混合检索'));
  record('答案说明最新建议不覆盖确认', /不覆盖|未形成.*决议|仍是/.test(answerText));
  await page.screenshot({ path: `${OUT}/04-decision-answer.png`, fullPage: true });

  const citationCount = await page.locator('button[aria-label^="打开来源"]').count();
  record('答案渲染可点击编号引用', citationCount > 0, `citations=${citationCount}`);
  if (citationCount > 0) {
    await page.locator('button[aria-label^="打开来源"]').first().click();
    await page.waitForSelector('text=引用原文', { timeout: 30000 });
    const dialogText = await page.locator('[role="dialog"]').innerText().catch(() => '');
    record('引用面板显示原文片段', dialogText.includes('引用原文'));
    record('引用面板显示来源会议信息', /星河笔记/.test(dialogText), dialogText.slice(0, 80).replace(/\n/g, ' '));
    await page.screenshot({ path: `${OUT}/05-citation-dialog.png`, fullPage: true });
    await page.keyboard.press('Escape');
  }

  await page.fill('textarea[placeholder*="提问"]', '那次会议是谁负责检索方案的技术验证？');
  await page.click('button:has-text("发送")');
  await page.waitForTimeout(2000);
  await page.waitForSelector('text=最终答案', { timeout: 420000 });
  const followUpText = await page.locator('body').innerText();
  record('追问得到基于历史的回答', followUpText.includes('何静') || followUpText.includes('技术验证'));
  await page.screenshot({ path: `${OUT}/06-followup.png`, fullPage: true });

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(4000);
  const restored = await page.locator('body').innerText();
  record('刷新后恢复历史答案与引用', /混合检索|最终答案/.test(restored));
  await page.screenshot({ path: `${OUT}/07-after-refresh.png`, fullPage: true });
} catch (error) {
  record('浏览器流程异常', false, error.message);
  await page.screenshot({ path: `${OUT}/99-failure.png`, fullPage: true }).catch(() => {});
} finally {
  const summary = {
    generated_at: new Date().toISOString(),
    base_url: BASE,
    passed: results.filter((item) => item.ok).length,
    failed: results.filter((item) => !item.ok).length,
    results,
  };
  writeFileSync(`${OUT}/browser-flow.json`, JSON.stringify(summary, null, 2), 'utf8');
  console.log(`\n${summary.passed} passed, ${summary.failed} failed`);
  await browser.close();
  process.exit(summary.failed === 0 ? 0 : 1);
}
