#!/usr/bin/env node
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { buildArticleId, extractWechatArticle, htmlToMarkdown, buildMarkdownDoc, pickOutDir, isProbablyWechatArticleUrl } from './core.mjs';
import { ensureDir, fetchBuffer, fetchHtml, readJsonFile, writeMarkdownFile } from './io.mjs';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: 'string' },
    cookie: { type: 'string' },
    'download-images': { type: 'boolean' }
  }
});

const url = positionals[0];
if (!url) {
  console.error('缺少 URL 参数');
  process.exit(1);
}

if (!isProbablyWechatArticleUrl(url)) {
  console.error('URL 不是公众号文章链接(mp.weixin.qq.com/s/...)');
  process.exit(1);
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(scriptDir, '..');
const configPath = path.join(skillRoot, 'config.json');

const cwd = process.cwd();
const homeDir = os.homedir();

const config = await readJsonFile(configPath);
const outDir = pickOutDir({
  cliOutDir: values.out,
  configOutDir: config?.outDir,
  cwd,
  homeDir
});

const cookie = values.cookie || config?.cookie || '';
const downloadImages = values['download-images'] ?? config?.downloadImages ?? false;

const fetchedAt = new Date().toISOString();
const articleId = buildArticleId(url);
const html = await fetchHtml(url, cookie ? { headers: { cookie } } : undefined);
const article = extractWechatArticle(html, url);
const contentMd = htmlToMarkdown(article.contentHtml);
const doc = buildMarkdownDoc({
  title: article.title,
  sourceUrl: url,
  fetchedAt,
  contentMarkdown: contentMd
});

const outputPath = await writeMarkdownFile({
  outDir,
  title: article.title,
  markdown: doc
});

if (downloadImages) {
  await downloadImagesForMarkdown({
    markdownPath: outputPath,
    cookie,
    articleId
  });
}

process.stdout.write(`${outputPath}\n`);

async function downloadImagesForMarkdown({ markdownPath, cookie, articleId }) {
  const mdDir = path.dirname(markdownPath);
  const safeId = String(articleId || '').trim() || 'wx-unknown';
  const imageDir = path.join(mdDir, safeId);
  const relPrefix = safeId;

  const raw = await fs.readFile(markdownPath, 'utf8');
  const urls = extractMarkdownImageUrls(raw);
  if (!urls.length) return;

  await ensureDir(imageDir);

  const urlToLocal = new Map();
  let index = 0;

  for (const imageUrl of urls) {
    index += 1;
    const { buffer, contentType } = await fetchBuffer(
      imageUrl,
      cookie ? { headers: { cookie } } : undefined
    );
    const ext = pickImageExt(imageUrl, contentType);
    const fileName = `img-${String(index).padStart(3, '0')}${ext}`;
    const filePath = path.join(imageDir, fileName);
    await fs.writeFile(filePath, buffer);
    urlToLocal.set(imageUrl, `${relPrefix}/${fileName}`);
  }

  let next = raw;
  for (const [u, local] of urlToLocal.entries()) {
    next = next.split(u).join(local);
  }

  if (next !== raw) {
    await fs.writeFile(markdownPath, next, 'utf8');
  }
}

function extractMarkdownImageUrls(markdown) {
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
