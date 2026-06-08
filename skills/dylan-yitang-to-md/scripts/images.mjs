import path from 'node:path';
import fs from 'node:fs/promises';
import { ensureDir, fetchBuffer } from './io.mjs';

export async function downloadImagesForMarkdown({ markdownPath, pageUrl, articleId, cookieHeader = '' }) {
  const startedAt = Date.now();
  const mdDir = path.dirname(markdownPath);
  const safeId = String(articleId || '').trim() || 'yt-unknown';
  const imageDir = path.join(mdDir, safeId);
  const relPrefix = safeId;

  const raw = await fs.readFile(markdownPath, 'utf8');
  const urls = extractMarkdownImageUrls(raw);
  if (!urls.length) {
    console.error('无图片，跳过');
    return { total: 0, ok: 0, failed: 0 };
  }
  console.error(`图片数量: ${urls.length}`);

  await ensureDir(imageDir);

  const urlToLocal = new Map();
  let index = 0;
  let ok = 0;
  let failed = 0;

  for (const imageUrl of urls) {
    index += 1;
    if (index === 1 || index % 10 === 0 || index === urls.length) {
      console.error(`图片下载进度: ${index}/${urls.length}`);
    }

    try {
      const secFetchSite = pickSecFetchSite(imageUrl, pageUrl);
      const { buffer, contentType } = await fetchBuffer(imageUrl, {
        headers: {
          ...(cookieHeader ? { cookie: cookieHeader } : {}),
          referer: pageUrl,
          'sec-fetch-site': secFetchSite,
          'sec-fetch-dest': 'image',
          'sec-fetch-mode': 'no-cors'
        }
      });
      const ext = pickImageExt(imageUrl, contentType);
      const fileName = `img-${String(index).padStart(3, '0')}${ext}`;
      const filePath = path.join(imageDir, fileName);
      await fs.writeFile(filePath, buffer);
      urlToLocal.set(imageUrl, `${relPrefix}/${fileName}`);
      ok += 1;
    } catch (e) {
      failed += 1;
      console.error(`图片下载失败(${index}/${urls.length}): ${String(e?.message || e || '')}`);
    }
  }

  if (urlToLocal.size) {
    let next = raw;
    for (const [u, local] of urlToLocal.entries()) {
      next = next.split(u).join(local);
    }
    if (next !== raw) {
      await fs.writeFile(markdownPath, next, 'utf8');
    }
  }

  const totalMs = Date.now() - startedAt;
  console.error(`图片下载完成: ok=${ok} failed=${failed} 用时 ${formatDuration(totalMs)}`);
  return { total: urls.length, ok, failed };
}

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

function pickSecFetchSite(requestUrl, refererUrl) {
  try {
    const a = new URL(requestUrl);
    const b = new URL(refererUrl);
    return a.origin === b.origin ? 'same-origin' : 'cross-site';
  } catch {
    return 'cross-site';
  }
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

function formatDuration(ms) {
  const n = Number(ms) || 0;
  if (n < 1000) return `${n}ms`;
  const s = Math.round((n / 1000) * 10) / 10;
  return `${s}s`;
}

