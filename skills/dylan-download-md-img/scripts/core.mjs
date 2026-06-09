import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { ensureDir, fetchBuffer } from './io.mjs';

export function extractMarkdownImageUrls(markdown) {
  const s = String(markdown || '');
  const re = /!\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  const list = [];
  const seen = new Set();
  for (;;) {
    const m = re.exec(s);
    if (!m) break;
    const url = (m[1] || '').trim();
    if (!/^https?:\/\//i.test(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    list.push(url);
  }
  return list;
}

export function buildMarkdownId(seed) {
  const s = String(seed || '').trim() || String(Date.now());
  const hash = crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);
  return `md-${hash}`;
}

export async function ensureMarkdownHasArticleId(markdownPath) {
  const absPath = path.resolve(markdownPath);
  const raw = await fs.readFile(absPath, 'utf8');
  const text = String(raw || '');

  const parsed = parseFrontmatter(text);
  const existing = String(parsed.meta.article_id || '').trim();
  if (existing) return { articleId: existing, changed: false };

  const articleId = buildMarkdownId(absPath);
  const next = upsertFrontmatterArticleId(text, articleId, parsed);
  if (next !== text) {
    await fs.writeFile(absPath, next, 'utf8');
  }
  return { articleId, changed: next !== text };
}

export async function downloadImagesAndRewriteMarkdown({ markdownPath, cookie = '', concurrency = 10, log = () => {} }) {
  const absPath = path.resolve(markdownPath);
  const mdDir = path.dirname(absPath);

  const { articleId } = await ensureMarkdownHasArticleId(absPath);
  const imageDir = path.join(mdDir, articleId);

  const raw = await fs.readFile(absPath, 'utf8');
  const urls = extractMarkdownImageUrls(raw);
  if (!urls.length) {
    log('未发现图片链接');
    return { articleId, imageDir, total: 0, downloaded: 0, rewritten: false };
  }

  await ensureDir(imageDir);

  log(`下载图片: ${urls.length} 张 -> ${imageDir}`);
  const urlToLocal = new Map();

  const parallel = Math.max(1, Number(concurrency) || 10);
  await runWithConcurrency(
    urls.map((imageUrl, i) => ({ imageUrl, index: i + 1 })),
    parallel,
    async ({ imageUrl, index }) => {
      log(`(${index}/${urls.length}) ${imageUrl}`);
      try {
        const { buffer, contentType } = await fetchImageBuffer(imageUrl, {
          cookie,
          timeoutMs: 30_000,
          retries: 2
        });
        const ext = pickImageExt(imageUrl, contentType);
        const fileName = `img-${String(index).padStart(3, '0')}${ext}`;
        const filePath = path.join(imageDir, fileName);
        await fs.writeFile(filePath, buffer);
        urlToLocal.set(imageUrl, `${articleId}/${fileName}`);
      } catch (e) {
        log(`下载失败，已跳过: ${String(e?.message || e)}`);
      }
    }
  );

  let next = raw;
  for (const [u, local] of urlToLocal.entries()) {
    next = next.split(u).join(local);
  }

  const rewritten = next !== raw;
  if (rewritten) {
    await fs.writeFile(absPath, next, 'utf8');
  }

  return {
    articleId,
    imageDir,
    total: urls.length,
    downloaded: urlToLocal.size,
    rewritten
  };
}

async function runWithConcurrency(items, concurrency, worker) {
  const limit = Math.max(1, Number(concurrency) || 1);
  let cursor = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = cursor;
      cursor += 1;
      if (i >= items.length) return;
      await worker(items[i], i);
    }
  });

  await Promise.all(runners);
}

async function fetchImageBuffer(url, { cookie, timeoutMs, retries }) {
  let lastErr = null;
  for (let i = 0; i <= retries; i += 1) {
    try {
      return await fetchBuffer(url, {
        ...(cookie ? { headers: { cookie } } : {}),
        timeoutMs
      });
    } catch (e) {
      lastErr = e;
      const msg = String(e?.message || e || '');
      const retryable =
        msg.includes('超时') ||
        msg.includes('ECONNRESET') ||
        msg.includes('ETIMEDOUT') ||
        msg.includes('EAI_AGAIN') ||
        msg.includes('socket hang up');
      if (!retryable || i === retries) break;
      await new Promise((r) => setTimeout(r, 350 * (i + 1)));
    }
  }
  throw lastErr;
}

function parseFrontmatter(text) {
  const s = String(text || '');
  const firstNewline = s.indexOf('\n');
  if (firstNewline === -1) return { hasFrontmatter: false, meta: {}, start: 0, end: 0 };
  if (s.slice(0, firstNewline).trim() !== '---') {
    return { hasFrontmatter: false, meta: {}, start: 0, end: 0 };
  }

  const rest = s.slice(firstNewline + 1);
  const m = rest.match(/\r?\n---\r?\n/);
  if (!m || typeof m.index !== 'number') {
    return { hasFrontmatter: false, meta: {}, start: 0, end: 0 };
  }

  const block = rest.slice(0, m.index);
  const meta = {};
  for (const line of block.split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const valueRaw = line.slice(idx + 1).trim();
    if (!key) continue;
    meta[key] = parseFrontmatterValue(valueRaw);
  }

  const start = 0;
  const end = firstNewline + 1 + m.index + m[0].length;
  return { hasFrontmatter: true, meta, start, end };
}

function parseFrontmatterValue(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

function upsertFrontmatterArticleId(text, articleId, parsed) {
  const idLine = `article_id: ${JSON.stringify(articleId)}`;
  if (!parsed?.hasFrontmatter) {
    return ['---', idLine, '---', '', String(text || '')].join('\n');
  }

  const before = text.slice(0, parsed.start);
  const fm = text.slice(parsed.start, parsed.end);
  const after = text.slice(parsed.end);

  const lines = fm.split(/\r?\n/);
  const hasId = lines.some((l) => l.trim().startsWith('article_id:'));
  if (hasId) return text;

  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    out.push(lines[i]);
    if (i === 0) out.push(idLine);
  }

  return before + out.join('\n') + after;
}

function pickImageExt(imageUrl, contentType) {
  try {
    const u = new URL(imageUrl);
    const ext = path.extname(u.pathname).toLowerCase();
    if (isSupportedImageExt(ext)) return ext;
  } catch {}

  const ct = String(contentType || '')
    .split(';')[0]
    .trim()
    .toLowerCase();

  if (ct === 'image/jpeg') return '.jpg';
  if (ct === 'image/jpg') return '.jpg';
  if (ct === 'image/png') return '.png';
  if (ct === 'image/gif') return '.gif';
  if (ct === 'image/webp') return '.webp';

  return '.jpg';
}

function isSupportedImageExt(ext) {
  return ext === '.jpg' || ext === '.jpeg' || ext === '.png' || ext === '.gif' || ext === '.webp';
}
