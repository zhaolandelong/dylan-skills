#!/usr/bin/env node
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { buildCookieHeader, readJsonFile } from './io.mjs';
import { pickOutDir } from './core.mjs';
import { downloadImagesForMarkdown } from './images.mjs';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: 'string' }
  }
});

const articleId = String(positionals[0] || '').trim();
if (!articleId) {
  console.error('缺少 articleId 参数');
  process.exit(1);
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(scriptDir, '..');
const configPath = path.join(skillRoot, 'config.json');
const storageStatePath = path.join(skillRoot, 'storageState.json');

const cwd = process.cwd();
const homeDir = os.homedir();
const config = await readJsonFile(configPath);

const outDir = pickOutDir({
  cliOutDir: values.out,
  configOutDir: config?.outDir,
  cwd,
  homeDir
});

const match = await findMarkdownByArticleId({ outDir, articleId });
if (!match) {
  console.error(`未找到文章: ${articleId} (outDir=${outDir})`);
  process.exit(1);
}

const { markdownPath, pageUrl } = match;
console.error(`开始下载图片: ${path.basename(markdownPath)}`);

const cookieHeader = await buildCookieHeaderFromStorageState(storageStatePath);
await downloadImagesForMarkdown({
  markdownPath,
  pageUrl,
  articleId,
  cookieHeader
});

process.stdout.write(`${markdownPath}\n`);

async function findMarkdownByArticleId({ outDir, articleId }) {
  const files = await listMarkdownFiles(outDir);
  for (const p of files) {
    const head = await readHead(p, 80_000);
    const id = extractFrontmatterValue(head, 'article_id');
    if (!id || id !== articleId) continue;
    const pageUrl = extractFrontmatterValue(head, 'source_url') || '';
    return { markdownPath: p, pageUrl };
  }
  return null;
}

async function listMarkdownFiles(dir) {
  const out = [];
  async function walk(p) {
    const entries = await fs.readdir(p, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(p, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) out.push(full);
    }
  }
  await walk(dir);
  return out;
}

async function readHead(filePath, limitBytes) {
  const fh = await fs.open(filePath, 'r');
  try {
    const buf = Buffer.alloc(limitBytes);
    const { bytesRead } = await fh.read(buf, 0, limitBytes, 0);
    return buf.subarray(0, bytesRead).toString('utf8');
  } finally {
    await fh.close();
  }
}

function extractFrontmatterValue(text, key) {
  const s = String(text || '');
  const m = s.match(new RegExp(`^${escapeRegExp(key)}:\\s*(.+)\\s*$`, 'm'));
  if (!m) return '';
  const raw = String(m[1] || '').trim();
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }
  return raw;
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&');
}

async function buildCookieHeaderFromStorageState(storageStatePath) {
  try {
    const json = await readJsonFile(storageStatePath);
    const cookies = Array.isArray(json?.cookies) ? json.cookies : [];
    return buildCookieHeader(cookies);
  } catch {
    return '';
  }
}

