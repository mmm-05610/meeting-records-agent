/**
 * Browser regression for history restore (v0.1.1).
 *
 * Run from apps/web:  node ../../tests/e2e/history-browser.test.mjs
 * Env: MRA_WEB_URL, HISTORY_THREAD (default restart-1792632748)
 */

import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require(resolve(process.cwd(), 'node_modules/playwright'));

const BASE = process.env.MRA_WEB_URL || 'http://127.0.0.1:3000';
const THREAD = process.env.HISTORY_THREAD || 'restart-1792632748';
const EMAIL = process.env.R2R_ADMIN_EMAIL || 'owner@meeting-records.local';
const PASSWORD = process.env.R2R_ADMIN_PASSWORD || 'owner_local_pw_2026';
const OUT = resolve(process.cwd(), '../../docs/evidence/screenshots');
mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(30000);

const login = async () => {
  await page.goto(`${BASE}/auth/login`, { waitUntil: 'networkidle' });
  await page.fill('#email', EMAIL);
  await page.fill('#password', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith('/auth'), { timeout: 30000 });
};

try {
  await login();
  await page.goto(`${BASE}/chat?thread=${THREAD}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(5000);
  let text = await page.locator('body').innerText();
  const count = (needle) => (text.match(new RegExp(needle, 'g')) || []).length;

  check('历史线程按角色显示用户问题', count('谁负责检索方案的技术验证？') >= 3, `occurrences=${count('谁负责检索方案的技术验证？')}`);
  check('成功轮次显示为已完成', count('已完成') >= 2, `completed=${count('已完成')}`);
  check('失败/重复轮次不再重复展示整段答案', count('本轮未完成') <= 1, `incomplete=${count('本轮未完成')}`);
  check('澄清轮次显示为需要澄清', count('需要澄清') === 2, `clarification=${count('需要澄清')}`);

  // Same thread after reload
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(4000);
  text = await page.locator('body').innerText();
  check('刷新后状态保持一致', count('需要澄清') === 2 && count('已完成') >= 2);
  await page.screenshot({ path: `${OUT}/11-history-pairing-fixed.png`, fullPage: true });

  // Fresh conversation end-to-end
  await page.goto(`${BASE}/chat`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  // force a brand new thread
  await page.evaluate(() => localStorage.removeItem('mra.thread_id'));
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.selectOption('#scope-project', { label: '模拟项目A：星河笔记' });
  await page.waitForTimeout(1200);
  await page.fill('textarea[placeholder*="提问"]', '谁负责检索方案的技术验证？');
  await page.click('button:has-text("发送")');
  await page.waitForSelector('text=已完成', { timeout: 180000 });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(4000);
  text = await page.locator('body').innerText();
  check('新会话刷新后仍为已完成', count('已完成') >= 1 && count('本轮未完成') === 0, `completed=${count('已完成')} incomplete=${count('本轮未完成')}`);
  await page.screenshot({ path: `${OUT}/12-fresh-thread-reload.png`, fullPage: true });
} catch (error) {
  check('浏览器历史回归异常', false, error.message);
  await page.screenshot({ path: `${OUT}/99-history-failure.png`, fullPage: true }).catch(() => {});
} finally {
  const summary = { thread: THREAD, passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results };
  writeFileSync(resolve(process.cwd(), '../../docs/evidence/history-browser.json'), JSON.stringify(summary, null, 2));
  console.log(`\n${summary.passed} passed, ${summary.failed} failed`);
  await browser.close();
  process.exit(summary.failed === 0 ? 0 : 1);
}
