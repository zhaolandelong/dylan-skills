#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { downloadImagesAndRewriteMarkdown } from './core.mjs';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    cookie: { type: 'string' }
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

const cookie = values.cookie || '';
const log = (message) => process.stderr.write(`[download-md-img] ${message}\n`);

log(`Markdown: ${absPath}`);
if (cookie) log('Cookie: 已提供');

await downloadImagesAndRewriteMarkdown({ markdownPath: absPath, cookie, log });

process.stdout.write(`${absPath}\n`);
