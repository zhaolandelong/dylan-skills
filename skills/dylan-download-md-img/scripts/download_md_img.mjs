#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { downloadImagesAndRewriteMarkdown } from './core.mjs';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    cookie: { type: 'string' },
    concurrency: { type: 'string' },
    'on-conflict': { type: 'string' }
  }
});

const mdPath = positionals[0];
if (!mdPath) {
  console.error('缺少 Markdown 路径参数');
  process.exit(1);
}

const absPath = path.resolve(process.cwd(), mdPath);
try {
  await fs.access(absPath);
} catch {
  console.error(`文件不存在: ${absPath}`);
  process.exit(1);
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(scriptDir, '..');
const configPath = path.join(skillRoot, 'config.json');
const config = await readJsonFile(configPath);

const cookie = values.cookie || String(config?.cookie || '');
const configConcurrency = Number.parseInt(String(config?.concurrency ?? ''), 10);
const cliConcurrency = Number.parseInt(String(values.concurrency || ''), 10);
const concurrency = Math.max(1, Number.isFinite(cliConcurrency) ? cliConcurrency : Number.isFinite(configConcurrency) ? configConcurrency : 10);
const onConflict = normalizeConflictPolicy(values['on-conflict'] || config?.onConflict);
const log = (message) => process.stderr.write(`[download-md-img] ${message}\n`);

log(`Markdown: ${absPath}`);
if (cookie) log('Cookie: 已显式提供');
else log('Cookie: 未显式提供，将尝试从 Markdown 头部注释读取');
log(`并发: ${concurrency}`);
log(`重名策略: ${onConflict}`);

await downloadImagesAndRewriteMarkdown({ markdownPath: absPath, cookie, concurrency, onConflict, log });

process.stdout.write(`${absPath}\n`);

async function readJsonFile(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const obj = JSON.parse(String(raw || ''));
    return obj && typeof obj === 'object' ? obj : {};
  } catch {
    return {};
  }
}

function normalizeConflictPolicy(policy) {
  const value = String(policy || '')
    .trim()
    .toLowerCase();
  if (value === 'overwrite' || value === 'rename') return value;
  return 'skip';
}
