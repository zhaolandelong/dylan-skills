#!/usr/bin/env node
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright-core';
import { buildArticleId, buildMarkdownDoc, htmlToMarkdown, isProbablyYitangDocUrl, normalizeContentHtml, pickOutDir } from './core.mjs';
import { buildCookieHeader, ensureDir, fileExists, parseCookieString, pickChromiumExecutablePath, readJsonFile, resolveMarkdownOutputTarget, writeMarkdownFile } from './io.mjs';
import { downloadImagesForMarkdown } from './images.mjs';

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36';
const DEFAULT_ACCEPT =
  'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7';
const DEFAULT_ACCEPT_LANGUAGE = 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7';
const QR_SCAN_TIMEOUT_MS = 2 * 60 * 1000;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: 'string' },
    cookie: { type: 'string' },
    'download-images': { type: 'boolean' },
    'no-download-images': { type: 'boolean' },
    headed: { type: 'boolean' },
    'on-conflict': { type: 'string' },
    overwrite: { type: 'boolean' },
    rename: { type: 'boolean' }
  }
});

const url = positionals[0];
if (!url) {
  console.error('缺少 URL 参数');
  process.exit(1);
}

if (!isProbablyYitangDocUrl(url)) {
  console.error('URL 不是一堂文档链接(yitang.top/fs-doc/...)');
  process.exit(1);
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(scriptDir, '..');
const configPath = path.join(skillRoot, 'config.json');

const cwd = process.cwd();
const homeDir = os.homedir();

const config = await readJsonFile(configPath);

const cookie = values.cookie ?? config?.cookie ?? '';
const storageStatePath = path.join(skillRoot, 'storageState.json');

const downloadImages = resolveDownloadImages({
  cliOn: values['download-images'],
  cliOff: values['no-download-images'],
  configValue: config?.downloadImages
});
const onConflict = resolveOnConflict({
  cliValue: values['on-conflict'],
  overwrite: values.overwrite,
  rename: values.rename,
  configValue: config?.onConflict
});

const headed = values.headed ?? false;
const headless = !headed;

const fetchedAt = new Date().toISOString();
const articleId = buildArticleId(url);

await main();

async function main() {
  const startedAt = Date.now();
  console.error(`开始下载: ${url}`);
  const executablePath = await pickChromiumExecutablePath();
  const browser = await chromium.launch({ headless, executablePath });
  const context = await createContext({
    browser,
    url,
    storageStatePath,
    cookie
  });

  try {
    const page = await context.newPage();
    console.error('打开页面...');
    await page.goto(url, { waitUntil: 'domcontentloaded' });

    await settleNavigation(page);

    if (await isLoginPage(page)) {
      if (cookie) {
        console.error('Cookie 可能无效或已失效，开始进入扫码登录流程');
      }
      await ensureLoggedInByQr({
        page,
        context,
        storageStatePath
      });
      await settleNavigation(page);
    }

    await waitForContentReady(page, 30000);

    const header = await extractPageHeader(page);
    const pageTitle = (await page.title()).trim();
    const title = pageTitle || header?.title || 'yitang-doc';
    console.error(`解析标题: ${title}`);

    const outDir = pickOutDir({
      cliOutDir: values.out,
      configOutDir: config?.outDir,
      cwd,
      homeDir
    });

    const preflightOutput = await resolveMarkdownOutputTarget({
      outDir,
      title,
      onConflict
    });
    if (preflightOutput.status === 'skipped') {
      console.error(`文件已存在，跳过下载: ${path.basename(preflightOutput.path)}`);
      process.stdout.write(`${preflightOutput.path}\n`);
      return;
    }

    console.error('抓取正文...');
    const { html: collectedHtml } = await runWithRetry(
      async () => await collectContentHtml(page, { warmupImages: downloadImages }),
      {
        retries: 3,
        shouldRetry: isExecutionContextDestroyedError
      }
    );

    const headerHtml = buildDocHeaderHtml({ title, lines: header?.lines || [] });
    const rawMain = [headerHtml, collectedHtml].filter(Boolean).join('\n');
    const contentHtml = normalizeContentHtml(rawMain);
    const contentMd = htmlToMarkdown(contentHtml);

    const doc = buildMarkdownDoc({
      title,
      sourceUrl: url,
      fetchedAt,
      contentMarkdown: contentMd
    });

    const output = await writeMarkdownFile({
      outDir,
      title,
      markdown: doc,
      onConflict
    });
    const outputPath = output.path;

    if (output.status === 'overwritten') {
      console.error(`文件已存在，已覆盖: ${path.basename(outputPath)}`);
    } else if (output.status === 'renamed') {
      console.error(`文件重名，已重命名保存: ${path.basename(outputPath)}`);
    }

    if (downloadImages) {
      console.error('下载图片...');
      const cookies = await context.cookies();
      const cookieHeader = buildCookieHeader(cookies);
      await downloadImagesForMarkdown({
        markdownPath: outputPath,
        pageUrl: url,
        articleId,
        cookieHeader
      });
    }

    await saveStorageStateSilently(context, storageStatePath);
    const totalMs = Date.now() - startedAt;
    console.error(`下载完成: ${path.basename(outputPath)} 用时 ${formatDuration(totalMs)}`);
    process.stdout.write(`${outputPath}\n`);
  } finally {
    await context.close();
    await browser.close();
  }
}

async function createContext({ browser, url, storageStatePath, cookie }) {
  const hasStorageState = storageStatePath && (await fileExists(storageStatePath));
  const context = await browser.newContext({
    storageState: hasStorageState ? storageStatePath : undefined,
    userAgent: DEFAULT_UA,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    extraHTTPHeaders: {
      accept: DEFAULT_ACCEPT,
      'accept-language': DEFAULT_ACCEPT_LANGUAGE,
      'cache-control': 'max-age=0',
      'upgrade-insecure-requests': '1'
    }
  });

  if (cookie) {
    const parsed = parseCookieString(cookie, [url, 'https://sso.yitang.top/']);
    if (parsed.length) {
      await context.addCookies(parsed);
    }
  }

  return context;
}

function resolveDownloadImages({ cliOn, cliOff, configValue }) {
  if (cliOff === true) return false;
  if (cliOn === true) return true;
  if (typeof configValue === 'boolean') return configValue;
  return false;
}

function resolveOnConflict({ cliValue, overwrite, rename, configValue }) {
  if (overwrite === true) return 'overwrite';
  if (rename === true) return 'rename';

  const value = String(cliValue || configValue || 'skip').trim().toLowerCase();
  if (value === 'skip' || value === 'overwrite' || value === 'rename') return value;

  console.error(`不支持的冲突策略: ${value}，可选值: skip | overwrite | rename`);
  process.exit(1);
}

async function isLoginPage(page) {
  const u = String(page.url() || '');
  try {
    const x = new URL(u);
    if (x.hostname === 'sso.yitang.top' && x.pathname.includes('/login')) return true;
  } catch {}
  if (u.includes('/login')) return true;

  try {
    return await page.evaluate(() => {
      const u = location.href;
      if (u.includes('/login')) return true;
      const s = document.body?.innerText || '';
      if (s.includes('微信登录')) return true;
      const title = document.title || '';
      if (title.includes('登录')) return true;
      return false;
    });
  } catch {
    return false;
  }
}

async function ensureLoggedInByQr({ page, context, storageStatePath }) {
  const screenshotPath = path.join(os.tmpdir(), `yitang-login-${Date.now()}.png`);
  await saveLoginQrScreenshot(page, screenshotPath);
  console.error(`请在 2 分钟内扫码登录: ${screenshotPath}`);

  await page.waitForFunction(() => {
    const u = location.href;
    if (u.includes('/fs-doc/')) return true;

    const s = (document.body?.innerText || '').trim();
    const isLoginLike = s.includes('微信登录') || (document.title || '').includes('登录') || u.includes('/login');
    if (!isLoginLike) return true;

    const mainCandidates = [
      document.querySelector('article'),
      document.querySelector('main'),
      document.querySelector('[role="main"]')
    ].filter(Boolean);
    const maxLen = Math.max(0, ...mainCandidates.map((el) => (el?.innerText || '').trim().length));
    return maxLen > 1000;
  }, { timeout: QR_SCAN_TIMEOUT_MS });

  await page.waitForLoadState('domcontentloaded');

  await saveStorageStateSilently(context, storageStatePath);
}

async function saveLoginQrScreenshot(page, outPath) {
  const handle = await pickBestQrLikeElement(page);
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
  try {
    await ensureDir(path.dirname(p));
    await context.storageState({ path: p });
  } catch (e) {
    const msg = String(e?.message || e || '');
    console.error(`保存登录态失败: ${msg}`);
  }
}

async function pickBestQrLikeElement(page) {
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

async function loadFullDocument(page, { warmupImages = true } = {}) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(500);

  let stableCount = 0;
  let last = await safeEvaluate(page, () => {
    const main = document.querySelector('.page-main');
    const root = main || document.body;

    function pickScrollableContainer(start) {
      let cur = start;
      for (let i = 0; i < 10 && cur; i += 1) {
        const style = window.getComputedStyle(cur);
        const oy = (style.overflowY || '').toLowerCase();
        const canScroll =
          (oy === 'auto' || oy === 'scroll' || oy === 'overlay') &&
          cur.scrollHeight > cur.clientHeight + 10;
        if (canScroll) return cur;
        cur = cur.parentElement;
      }
      return document.scrollingElement || document.documentElement || document.body;
    }

    const container = pickScrollableContainer(root);
    const text = (main?.innerText || root?.innerText || '').trim();
    return {
      textLen: text.length,
      scrollHeight: container?.scrollHeight || 0,
      clientHeight: container?.clientHeight || 0,
      scrollTop: container?.scrollTop || 0
    };
  });

  for (let round = 0; round < 160; round += 1) {
    await safeEvaluate(page, () => {
      const main = document.querySelector('.page-main');
      const root = main || document.body;

      function pickScrollableContainer(start) {
        let cur = start;
        for (let i = 0; i < 10 && cur; i += 1) {
          const style = window.getComputedStyle(cur);
          const oy = (style.overflowY || '').toLowerCase();
          const canScroll =
            (oy === 'auto' || oy === 'scroll' || oy === 'overlay') &&
            cur.scrollHeight > cur.clientHeight + 10;
          if (canScroll) return cur;
          cur = cur.parentElement;
        }
        return document.scrollingElement || document.documentElement || document.body;
      }

      const container = pickScrollableContainer(root);
      const targetTop = Math.max(0, (container?.scrollHeight || 0) - (container?.clientHeight || 0));
      if (container === document.scrollingElement || container === document.documentElement || container === document.body) {
        window.scrollTo(0, container?.scrollHeight || 0);
      } else {
        container.scrollTop = targetTop;
      }

      const buttons = Array.from(root?.querySelectorAll?.('button,a') || []);
      for (const b of buttons) {
        const t = (b?.innerText || '').trim();
        if (!t) continue;
        if (t.includes('加载更多') || t.includes('展开') || t.includes('继续')) {
          const rect = b.getBoundingClientRect?.();
          if (rect && rect.width > 0 && rect.height > 0) {
            try {
              b.click();
            } catch {}
          }
        }
      }
    });

    await page.waitForLoadState('networkidle', { timeout: 1500 }).catch(() => {});
    await page.waitForTimeout(450);

    const next = await safeEvaluate(page, () => {
      const main = document.querySelector('.page-main');
      const root = main || document.body;

      function pickScrollableContainer(start) {
        let cur = start;
        for (let i = 0; i < 10 && cur; i += 1) {
          const style = window.getComputedStyle(cur);
          const oy = (style.overflowY || '').toLowerCase();
          const canScroll =
            (oy === 'auto' || oy === 'scroll' || oy === 'overlay') &&
            cur.scrollHeight > cur.clientHeight + 10;
          if (canScroll) return cur;
          cur = cur.parentElement;
        }
        return document.scrollingElement || document.documentElement || document.body;
      }

      const container = pickScrollableContainer(root);
      const text = (main?.innerText || root?.innerText || '').trim();
      return {
        textLen: text.length,
        scrollHeight: container?.scrollHeight || 0,
        clientHeight: container?.clientHeight || 0,
        scrollTop: container?.scrollTop || 0
      };
    });

    const textGrew = next.textLen > last.textLen + 50;
    const heightGrew = next.scrollHeight > last.scrollHeight + 20;
    const atBottom = next.scrollTop + next.clientHeight >= next.scrollHeight - 10;

    if (textGrew || heightGrew) {
      stableCount = 0;
      last = next;
      continue;
    }

    if (atBottom) stableCount += 1;
    else stableCount = 0;

    if (stableCount >= 6) break;
    last = next;
  }

  await runWithRetry(
    async () => {
      if (!warmupImages) return;
      const imgs = await page.$$('img');
      for (const img of imgs) {
        try {
          await img.scrollIntoViewIfNeeded();
          await page.waitForFunction((el) => el.complete || el.naturalWidth > 0, img, {
            timeout: 5000
          });
        } catch {}
      }
    },
    { retries: 2, shouldRetry: isExecutionContextDestroyedError }
  );
}

async function extractPageHeader(page) {
  const payload = await safeEvaluate(page, () => {
    const root = document.querySelector('.page-block-header');
    if (!root) return { title: '', lines: [] };

    function pickTitle(el) {
      const candidates = [
        el.querySelector('h1'),
        el.querySelector('h2'),
        el.querySelector('[class*="title"]'),
        el.querySelector('[class*="name"]')
      ].filter(Boolean);
      for (const c of candidates) {
        const t = (c.innerText || c.textContent || '').trim();
        if (t) return t;
      }
      const t = (el.innerText || el.textContent || '').trim();
      return t.split('\n').map((x) => x.trim()).filter(Boolean)[0] || '';
    }

    const title = pickTitle(root);

    const text = (root.innerText || root.textContent || '').trim();
    const lines = text
      .split('\n')
      .map((x) => x.trim())
      .filter(Boolean)
      .filter((x) => x !== title)
      .slice(0, 10);

    return { title, lines };
  });

  const title = String(payload?.title || '').trim();
  const lines = Array.isArray(payload?.lines) ? payload.lines : [];

  if (!title && !lines.length) return null;
  return { title, lines };
}

function escapeHtml(s) {
  return String(s || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function buildDocHeaderHtml({ title, lines }) {
  const t = String(title || '').trim();
  const ls = Array.isArray(lines) ? lines : [];
  const safeTitle = escapeHtml(t);
  const ps = ls
    .map((x) => `<p>${escapeHtml(String(x || '').trim())}</p>`)
    .join('');
  if (!safeTitle && !ps) return '';
  return `<section class="__yitang_header__">${safeTitle ? `<h1>${safeTitle}</h1>` : ''}${ps}</section>`;
}

async function collectMainContentHtml(page, { warmupImages }) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(300);

  const seen = new Set();
  const ordered = [];
  let stableCount = 0;

  await safeEvaluate(page, () => {
    const main = document.querySelector('.page-main');
    const root = main || document.body;
    const childRoot = main?.querySelector?.('.page-block-children');

    function pickScrollableContainer(start) {
      let cur = start;
      for (let i = 0; i < 12 && cur; i += 1) {
        const style = window.getComputedStyle(cur);
        const oy = (style.overflowY || '').toLowerCase();
        const canScroll =
          (oy === 'auto' || oy === 'scroll' || oy === 'overlay') &&
          cur.scrollHeight > cur.clientHeight + 10;
        if (canScroll) return cur;
        cur = cur.parentElement;
      }
      return document.scrollingElement || document.documentElement || document.body;
    }

    const scroller = pickScrollableContainer(childRoot || root);
    if (scroller === document.scrollingElement || scroller === document.documentElement || scroller === document.body) {
      window.scrollTo(0, 0);
    } else {
      scroller.scrollTop = 0;
    }
  });

  let lastLen = 0;

  for (let step = 0; step < 320; step += 1) {
    const snapshot = await safeEvaluate(page, () => {
      const main = document.querySelector('.page-main');
      if (!main) return { blocks: [], atBottom: true, contentLen: 0 };
      const childRoot = main.querySelector?.('.page-block-children');

      function pickBlockRoot(node) {
        let cur = node;
        for (let i = 0; i < 4; i += 1) {
          const kids = Array.from(cur.children || []).filter((x) => x && x.tagName);
          if (kids.length > 1) return cur;
          if (kids.length === 1) cur = kids[0];
          else return cur;
        }
        return cur;
      }

      function pickScrollableContainer(start) {
        let cur = start;
        for (let i = 0; i < 12 && cur; i += 1) {
          const style = window.getComputedStyle(cur);
          const oy = (style.overflowY || '').toLowerCase();
          const canScroll =
            (oy === 'auto' || oy === 'scroll' || oy === 'overlay') &&
            cur.scrollHeight > cur.clientHeight + 10;
          if (canScroll) return cur;
          cur = cur.parentElement;
        }
        return document.scrollingElement || document.documentElement || document.body;
      }

      const blockRoot = childRoot || pickBlockRoot(main);
      const children = Array.from(blockRoot.children || []);

      function signatureFor(el, html) {
        const tag = (el.tagName || '').toLowerCase();

        const attrNames = el.getAttributeNames ? el.getAttributeNames() : [];
        const idLike =
          el.getAttribute?.('data-block-id') ||
          el.getAttribute?.('data-node-id') ||
          el.getAttribute?.('data-id') ||
          el.getAttribute?.('data-key') ||
          el.getAttribute?.('id') ||
          attrNames
            .filter((n) => n && /id$/i.test(n))
            .map((n) => `${n}:${el.getAttribute?.(n) || ''}`)
            .find((x) => x && !x.endsWith(':')) ||
          '';
        if (idLike) return `${tag}|id:${idLike}`;

        const rawText = el.innerText || el.textContent || '';
        const fullText = String(rawText)
          .replace(/[\u200B-\u200D\uFEFF]/g, '')
          .trim()
          .replace(/\s+/g, ' ');
        const head = fullText.slice(0, 240);
        const tail = fullText.length > 240 ? fullText.slice(-240) : '';

        const imgs = el.querySelectorAll?.('img') || [];
        const img1 = imgs[0]?.getAttribute?.('src') || '';
        const imgCount = imgs.length || 0;

        function hashString(s) {
          let h = 5381;
          for (let i = 0; i < s.length; i += 1) h = ((h << 5) + h) ^ s.charCodeAt(i);
          return (h >>> 0).toString(16);
        }

        const h = hashString(`${tag}|${head}|${tail}|img:${imgCount}|${img1}`);
        return `${tag}|h:${h}`;
      }

      const blocks = [];
      for (const el of children) {
        if (!el) continue;
        const html = el.outerHTML || '';
        const sig = signatureFor(el, html);
        if (!sig || !html) continue;
        blocks.push({ sig, html });
      }

      const scroller = pickScrollableContainer(childRoot || main);
      const sh = scroller?.scrollHeight || 0;
      const ch = scroller?.clientHeight || 0;
      const st = scroller?.scrollTop || 0;
      const atBottom = st + ch >= sh - 10;
      const contentLen = (main.innerText || '').trim().length;

      return { blocks, atBottom, contentLen, sh, ch, st };
    });

    for (const b of snapshot.blocks) {
      if (!seen.has(b.sig)) {
        seen.add(b.sig);
        ordered.push(b);
      }
    }

    if (snapshot.contentLen > lastLen + 50) {
      stableCount = 0;
      lastLen = snapshot.contentLen;
    } else {
      stableCount += 1;
    }

    if (snapshot.atBottom && stableCount >= 10) break;

    await safeEvaluate(page, () => {
      const main = document.querySelector('.page-main');
      if (!main) return;
      const childRoot = main.querySelector?.('.page-block-children');

      function pickScrollableContainer(start) {
        let cur = start;
        for (let i = 0; i < 12 && cur; i += 1) {
          const style = window.getComputedStyle(cur);
          const oy = (style.overflowY || '').toLowerCase();
          const canScroll =
            (oy === 'auto' || oy === 'scroll' || oy === 'overlay') &&
            cur.scrollHeight > cur.clientHeight + 10;
          if (canScroll) return cur;
          cur = cur.parentElement;
        }
        return document.scrollingElement || document.documentElement || document.body;
      }

      const scroller = pickScrollableContainer(childRoot || main);
      const delta = Math.max(200, Math.floor((scroller?.clientHeight || 800) * 0.85));
      if (scroller === document.scrollingElement || scroller === document.documentElement || scroller === document.body) {
        window.scrollBy(0, delta);
      } else {
        scroller.scrollTop = Math.min(scroller.scrollTop + delta, scroller.scrollHeight);
      }
    });

    await page.waitForLoadState('networkidle', { timeout: 1500 }).catch(() => {});
    await page.waitForTimeout(200);

    if (warmupImages) {
      await safeEvaluate(page, () => {
        const main = document.querySelector('.page-main');
        const imgs = Array.from(main?.querySelectorAll?.('img') || []);
        for (const img of imgs) {
          try {
            img.scrollIntoView({ block: 'nearest' });
          } catch {}
        }
      });
    }
  }

  const html = ordered.map((b) => b.html).join('\n');
  return { html, count: ordered.length };
}

async function collectContentHtml(page, { warmupImages }) {
  const hasPageBlockChildren = await waitForPageBlockChildrenReady(page, 6000);
  if (hasPageBlockChildren) {
    return await collectPageBlockChildrenHtml(page, { warmupImages });
  }
  return await collectMainContentHtml(page, { warmupImages });
}

async function waitForPageBlockChildrenReady(page, timeoutMs) {
  const started = Date.now();
  for (;;) {
    const ok = await safeEvaluate(page, () => {
      const root = document.querySelector('.page-block-children');
      const len = root?.children?.length || 0;
      return Boolean(root) && len > 0;
    });
    if (ok) return true;
    if (Date.now() - started > timeoutMs) return false;
    await page.waitForLoadState('networkidle', { timeout: 1500 }).catch(() => {});
    await page.waitForTimeout(200);
  }
}

async function collectPageBlockChildrenHtml(page, { warmupImages }) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(300);

  await safeEvaluate(page, () => {
    const root = document.querySelector('.page-block-children');
    if (!root) return;

    const store = {
      seen: Object.create(null),
      ordered: [],
      lastChangedAt: Date.now()
    };

    function pickStableItemId(el) {
      const cls = String(el.getAttribute?.('class') || '')
        .split(/\s+/)
        .filter(Boolean);
      for (const c of cls) {
        if (!c.startsWith('item-')) continue;
        if (/^item-\d+$/.test(c)) continue;
        if (c.length <= 10) continue;
        return c;
      }
      return '';
    }

    function hashString(s) {
      let h = 5381;
      for (let i = 0; i < s.length; i += 1) h = ((h << 5) + h) ^ s.charCodeAt(i);
      return (h >>> 0).toString(16);
    }

    function signatureFor(el, html) {
      const itemId = pickStableItemId(el);
      if (itemId) return itemId;
      const tag = (el.tagName || '').toLowerCase();
      const rawText = el.innerText || el.textContent || '';
      const fullText = String(rawText)
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        .trim()
        .replace(/\s+/g, ' ');
      const head = fullText.slice(0, 240);
      const tail = fullText.length > 240 ? fullText.slice(-240) : '';
      return `${tag}|h:${hashString(`${head}|${tail}|${String(html || '').length}`)}`;
    }

    function captureChildren() {
      const kids = Array.from(root.querySelectorAll?.('.listitem') || []);
      let changed = false;
      for (const el of kids) {
        if (!el) continue;
        const html = el.outerHTML || '';
        const sig = signatureFor(el, html);
        if (!sig || !html) continue;
        if (store.seen[sig]) continue;
        store.seen[sig] = 1;
        store.ordered.push(html);
        changed = true;
      }
      if (changed) store.lastChangedAt = Date.now();
    }

    captureChildren();

    const prevRoot = window.__yt_block_observer_root__;
    if (prevRoot !== root) {
      try {
        window.__yt_block_observer__?.disconnect?.();
      } catch {}
      const obs = new MutationObserver(() => captureChildren());
      obs.observe(root, { childList: true, subtree: true });
      window.__yt_block_observer__ = obs;
      window.__yt_block_observer_root__ = root;
    }

    window.__yt_block_store__ = store;

    function pickScrollableContainer(start) {
      let cur = start;
      for (let i = 0; i < 12 && cur; i += 1) {
        const style = window.getComputedStyle(cur);
        const oy = (style.overflowY || '').toLowerCase();
        const canScroll =
          (oy === 'auto' || oy === 'scroll' || oy === 'overlay') &&
          cur.scrollHeight > cur.clientHeight + 10;
        if (canScroll) return cur;
        cur = cur.parentElement;
      }
      return document.scrollingElement || document.documentElement || document.body;
    }

    const scroller = pickScrollableContainer(root);
    if (scroller === document.scrollingElement || scroller === document.documentElement || scroller === document.body) {
      window.scrollTo(0, 0);
    } else {
      scroller.scrollTop = 0;
    }
  });

  let stable = 0;
  let lastCount = 0;

  for (let step = 0; step < 420; step += 1) {
    const snapshot = await safeEvaluate(page, () => {
      const root = document.querySelector('.page-block-children');
      const store = window.__yt_block_store__;
      const count = Array.isArray(store?.ordered) ? store.ordered.length : 0;

      function pickScrollableContainer(start) {
        let cur = start;
        for (let i = 0; i < 12 && cur; i += 1) {
          const style = window.getComputedStyle(cur);
          const oy = (style.overflowY || '').toLowerCase();
          const canScroll =
            (oy === 'auto' || oy === 'scroll' || oy === 'overlay') &&
            cur.scrollHeight > cur.clientHeight + 10;
          if (canScroll) return cur;
          cur = cur.parentElement;
        }
        return document.scrollingElement || document.documentElement || document.body;
      }

      const scroller = pickScrollableContainer(root || document.body);
      const sh = scroller?.scrollHeight || 0;
      const ch = scroller?.clientHeight || 0;
      const st = scroller?.scrollTop || 0;
      const atBottom = st + ch >= sh - 10;

      const textLen = (root?.innerText || '').trim().length;
      const lastChangedAt = Number(store?.lastChangedAt || 0);

      return { count, atBottom, sh, ch, st, textLen, lastChangedAt };
    });

    if (snapshot.count > lastCount) {
      stable = 0;
      lastCount = snapshot.count;
    } else {
      stable += 1;
    }

    const noChangesRecently = Date.now() - snapshot.lastChangedAt > 1500;
    if (snapshot.atBottom && stable >= 10 && noChangesRecently) break;

    await safeEvaluate(page, () => {
      const root = document.querySelector('.page-block-children');

      function pickScrollableContainer(start) {
        let cur = start;
        for (let i = 0; i < 12 && cur; i += 1) {
          const style = window.getComputedStyle(cur);
          const oy = (style.overflowY || '').toLowerCase();
          const canScroll =
            (oy === 'auto' || oy === 'scroll' || oy === 'overlay') &&
            cur.scrollHeight > cur.clientHeight + 10;
          if (canScroll) return cur;
          cur = cur.parentElement;
        }
        return document.scrollingElement || document.documentElement || document.body;
      }

      const scroller = pickScrollableContainer(root || document.body);
      const delta = Math.max(200, Math.floor((scroller?.clientHeight || 800) * 0.85));
      if (scroller === document.scrollingElement || scroller === document.documentElement || scroller === document.body) {
        window.scrollBy(0, delta);
      } else {
        scroller.scrollTop = Math.min(scroller.scrollTop + delta, scroller.scrollHeight);
      }
    });

    await page.waitForLoadState('networkidle', { timeout: 1500 }).catch(() => {});
    await page.waitForTimeout(220);

    if (warmupImages) {
      await safeEvaluate(page, () => {
        const root = document.querySelector('.page-block-children');
        const imgs = Array.from(root?.querySelectorAll?.('img') || []);
        for (const img of imgs) {
          try {
            img.scrollIntoView({ block: 'nearest' });
          } catch {}
        }
      });
    }
  }

  const html = await safeEvaluate(page, () => {
    const store = window.__yt_block_store__;
    return Array.isArray(store?.ordered) ? store.ordered.join('\n') : '';
  });

  return { html, count: lastCount };
}

async function waitForContentReady(page, timeoutMs) {
  const started = Date.now();
  for (;;) {
    const now = Date.now();
    if (now - started > timeoutMs) return;

    const snapshot = await safeEvaluate(page, () => {
      const text = (document.body?.innerText || '').trim();
      const candidates = [
        document.querySelector('article'),
        document.querySelector('main'),
        document.querySelector('[role="main"]'),
        document.querySelector('.doc-content'),
        document.querySelector('#app')
      ].filter(Boolean);
      const mainTextLength = Math.max(
        0,
        ...candidates.map((el) => (el?.innerText || '').trim().length)
      );
      return { bodyTextLength: text.length, mainTextLength, textHead: text.slice(0, 50) };
    });

    const looksLikeLoading =
      snapshot.bodyTextLength <= 20 ||
      snapshot.textHead.includes('加载中') ||
      snapshot.textHead.includes('loading');

    if (!looksLikeLoading && (snapshot.mainTextLength >= 800 || snapshot.bodyTextLength >= 1200)) return;

    await page.waitForLoadState('networkidle', { timeout: 1500 }).catch(() => {});
    await page.waitForTimeout(250);
  }
}

async function settleNavigation(page) {
  let stable = 0;
  let last = '';
  for (let i = 0; i < 12; i += 1) {
    const cur = String(page.url() || '');
    if (cur === last) stable += 1;
    else stable = 0;
    last = cur;
    if (stable >= 2) break;
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 1500 }).catch(() => {});
    await page.waitForTimeout(200);
  }
}

async function extractMainContentHtml(page) {
  const html = await safeEvaluate(page, () => {
    const main = document.querySelector('.page-main');
    if (main) return main.innerHTML || '';

    const candidates = [
      'article',
      'main',
      '[role="main"]',
      '.doc-content',
      '.document',
      '.doc',
      '#app',
      'body'
    ];

    function score(el) {
      if (!el) return 0;
      const rect = el.getBoundingClientRect?.();
      if (!rect || rect.width <= 0 || rect.height <= 0) return 0;
      const text = (el.innerText || '').trim();
      return text.length;
    }

    let best = null;
    let bestScore = 0;
    for (const sel of candidates) {
      const els = Array.from(document.querySelectorAll(sel));
      for (const el of els) {
        const s = score(el);
        if (s > bestScore) {
          bestScore = s;
          best = el;
        }
      }
      if (bestScore > 2000) break;
    }

    if (!best) best = document.body;
    return best?.innerHTML || '';
  });

  if (!String(html || '').trim()) {
    throw new Error('正文抽取失败：页面内容为空');
  }

  return html;
}

async function safeEvaluate(page, fn, arg) {
  try {
    return await page.evaluate(fn, arg);
  } catch (e) {
    if (!isExecutionContextDestroyedError(e)) throw e;
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(200);
    return await page.evaluate(fn, arg);
  }
}

function isExecutionContextDestroyedError(e) {
  const msg = String(e?.message || '');
  return msg.includes('Execution context was destroyed');
}

async function runWithRetry(fn, { retries, shouldRetry }) {
  let lastErr = null;
  for (let i = 0; i < retries; i += 1) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (!shouldRetry?.(e)) throw e;
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  throw lastErr;
}

function formatDuration(ms) {
  const n = Number(ms) || 0;
  if (n < 1000) return `${n}ms`;
  const s = Math.round((n / 1000) * 10) / 10;
  return `${s}s`;
}
