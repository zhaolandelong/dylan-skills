#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright-core';
import { ensureDir, pickChromiumExecutablePath } from './io.mjs';

const LOGIN_URL = 'https://sso.yitang.top/account/login/';
const QR_SCAN_TIMEOUT_MS = 2 * 60 * 1000;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    url: { type: 'string' }
  }
});

const targetUrl = String(positionals[0] || values.url || 'https://yitang.top/').trim();

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(scriptDir, '..');
const storageStatePath = path.join(skillRoot, 'storageState.json');

const executablePath = await pickChromiumExecutablePath();
const browser = await chromium.launch({ headless: true, executablePath });
const context = await browser.newContext({
  locale: 'zh-CN',
  timezoneId: 'Asia/Shanghai'
});

try {
  const page = await context.newPage();
  console.error('打开登录页...');
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });
  const qrTarget = await waitForQrReady(page);

  const screenshotPath = path.join(skillRoot, 'login-qr.png');
  await saveLoginQrScreenshot(page, screenshotPath, qrTarget);
  console.error(`二维码图片: ${screenshotPath}`);
  const terminalQr = await renderQrToTerminal(page, qrTarget);

  process.stdout.write(`${screenshotPath}\n`);
  if (terminalQr) {
    console.error('终端扫码预览:');
    console.error(terminalQr);
  }
  console.error('请在 2 分钟内扫码登录');

  await page.waitForFunction(() => {
    const u = location.href;
    if (!u.includes('/account/login')) return true;
    const s = (document.body?.innerText || '').trim();
    const isLoginLike = s.includes('微信登录') || (document.title || '').includes('登录') || u.includes('/login');
    if (!isLoginLike) return true;
    return false;
  }, { timeout: QR_SCAN_TIMEOUT_MS });

  await page.waitForLoadState('domcontentloaded');
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await saveStorageStateSilently(context, storageStatePath);
  await verifyStorageState(storageStatePath, targetUrl);
  console.error(`登录完成，已更新: ${storageStatePath}`);
} finally {
  await context.close();
  await browser.close();
}

async function saveLoginQrScreenshot(page, outPath, qrTarget) {
  const handle = await pickBestQrLikeElement(page, qrTarget);
  if (handle) {
    try {
      await handle.screenshot({ path: outPath });
      return;
    } catch {}
  }
  await page.screenshot({ path: outPath, fullPage: true });
}

async function saveStorageStateSilently(context, storageStatePath) {
  const p = String(storageStatePath || '').trim();
  if (!p) return;
  await ensureDir(path.dirname(p));
  await context.storageState({ path: p });
}

async function pickBestQrLikeElement(page, qrTarget) {
  if (qrTarget?.kind === 'main-img') {
    const direct = await page.$('img.qrcode.lightBorder.js_qrcode_img');
    if (direct) return direct;
  }

  if (qrTarget?.kind === 'login-frame-img') {
    const handle = await getIframeQrImage(page);
    if (handle) return handle;
  }

  if (qrTarget?.kind === 'login-container') {
    const container = await page.$('#login_container');
    if (container) return container;
  }

  if (qrTarget?.kind === 'login-iframe') {
    const iframeEl = await page.$('#login_container iframe');
    if (iframeEl) return iframeEl;
  }

  const direct = await page.$('img.qrcode.lightBorder.js_qrcode_img');
  if (direct) return direct;

  const frameImg = await getIframeQrImage(page);
  if (frameImg) return frameImg;

  const container = await page.$('#login_container');
  if (container) return container;

  const iframeEl = await page.$('#login_container iframe');
  if (iframeEl) return iframeEl;

  const handles = await page.$$('canvas, img');
  if (!handles.length) return null;

  const scored = [];
  for (const h of handles) {
    try {
      const box = await h.boundingBox();
      if (!box) continue;
      const w = box.width;
      const hgt = box.height;
      const minSide = Math.min(w, hgt);
      const maxSide = Math.max(w, hgt);
      if (minSide < 140) continue;
      if (maxSide / minSide > 1.15) continue;
      const area = w * hgt;
      scored.push({ handle: h, score: area });
    } catch {}
  }

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.handle || null;
}

async function waitForQrReady(page) {
  const startedAt = Date.now();
  for (;;) {
    const mainImgReady = await page.evaluate(() => {
      const img = document.querySelector('img.qrcode.lightBorder.js_qrcode_img');
      return Boolean(img && img.complete && img.naturalWidth > 0 && img.naturalHeight > 0);
    }).catch(() => false);
    if (mainImgReady) return { kind: 'main-img' };

    const iframeQr = await getIframeQrImage(page);
    if (iframeQr) return { kind: 'login-frame-img' };

    const containerEl = await page.$('#login_container');
    if (containerEl) {
      const box = await containerEl.boundingBox().catch(() => null);
      if (box && box.width > 120 && box.height > 120) return { kind: 'login-container' };
    }

    const iframeEl = await page.$('#login_container iframe');
    if (iframeEl) {
      const box = await iframeEl.boundingBox().catch(() => null);
      if (box && box.width > 120 && box.height > 120) return { kind: 'login-iframe' };
    }

    if (Date.now() - startedAt > QR_SCAN_TIMEOUT_MS) {
      throw new Error('二维码在 2 分钟内未出现：主页面 img、#login_container、#login_container iframe 都未就绪');
    }
    await page.waitForTimeout(300);
  }
}

async function renderQrToTerminal(page, qrTarget) {
  if (qrTarget?.kind === 'login-container' || qrTarget?.kind === 'login-iframe' || qrTarget?.kind === 'login-frame-img') return '';
  try {
    return await page.evaluate(async () => {
      const img = document.querySelector('img.qrcode.lightBorder.js_qrcode_img');
      if (!img || !img.complete || img.naturalWidth <= 0 || img.naturalHeight <= 0) return '';

      const size = 48;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return '';

      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, size, size);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, 0, 0, size, size);

      const data = ctx.getImageData(0, 0, size, size).data;
      const lines = [];
      const black = '██';
      const white = '  ';

      function isDarkAt(x, y) {
        const i = (y * size + x) * 4;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const a = data[i + 3];
        if (a < 32) return false;
        const luma = 0.299 * r + 0.587 * g + 0.114 * b;
        return luma < 180;
      }

      for (let y = 0; y < size; y += 1) {
        let line = '';
        for (let x = 0; x < size; x += 1) {
          line += isDarkAt(x, y) ? black : white;
        }
        lines.push(line);
      }

      return lines.join('\n');
    });
  } catch {
    return '';
  }
}

async function getIframeQrImage(page) {
  try {
    const iframeEl = await page.$('#login_container iframe');
    if (!iframeEl) return null;
    const frame = await iframeEl.contentFrame();
    if (!frame) return null;
    const img = await frame.$('img.qrcode');
    if (!img) return null;
    const box = await img.boundingBox().catch(() => null);
    if (!box || box.width < 100 || box.height < 100) return null;
    return img;
  } catch {
    return null;
  }
}

async function verifyStorageState(storageStatePath, url) {
  const browser = await chromium.launch({ headless: true, executablePath: await pickChromiumExecutablePath() });
  const context = await browser.newContext({
    storageState: storageStatePath,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai'
  });
  try {
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

    const isLogin = await page.evaluate(() => {
      const u = location.href;
      const s = (document.body?.innerText || '').trim();
      if (u.includes('/account/login') || u.includes('/login')) return true;
      if (s.includes('微信登录')) return true;
      const title = (document.title || '').trim();
      if (title.includes('登录')) return true;
      return false;
    }).catch(() => false);

    if (isLogin) {
      const out = path.join(skillRoot, 'login-verify.png');
      await page.screenshot({ path: out, fullPage: true }).catch(() => {});
      throw new Error(`storageState 校验失败：仍然是登录页（截图: ${out}）`);
    }
  } finally {
    await context.close();
    await browser.close();
  }
}
