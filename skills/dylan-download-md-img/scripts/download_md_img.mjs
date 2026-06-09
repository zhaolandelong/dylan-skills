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
    concurrency: { type: 'string' }
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

const cookie = values.cookie || '';
const configConcurrency = Number.parseInt(String(config?.concurrency ?? ''), 10);
const cliConcurrency = Number.parseInt(String(values.concurrency || ''), 10);
const concurrency = Math.max(1, Number.isFinite(cliConcurrency) ? cliConcurrency : Number.isFinite(configConcurrency) ? configConcurrency : 10);
const log = (message) => process.stderr.write(`[download-md-img] ${message}\n`);

log(`Markdown: ${absPath}`);
if (cookie) log('Cookie: 已提供');
log(`并发: ${concurrency}`);

await downloadImagesAndRewriteMarkdown({ markdownPath: absPath, cookie, concurrency, log });

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
