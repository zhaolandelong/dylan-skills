#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright-core';
import { fileExists, pickChromiumExecutablePath, readJsonFile } from './io.mjs';

const API_PREFIX = 'https://yitang.top/api/feishu/get-doc-blocks';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: 'string' },
    state: { type: 'string' },
    scroll: { type: 'string' },
    headed: { type: 'boolean' }
  }
});

const url = positionals[0];
if (!url) {
  console.error('缺少 URL 参数');
  process.exit(1);
}

const cwd = process.cwd();
const outPath = path.resolve(cwd, values.out || './data.txt');

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(scriptDir, '..');
const configPath = path.join(skillRoot, 'config.json');
const storageStatePath = path.resolve(skillRoot, values.state || './storageState.json');
const hasStorageState = await fileExists(storageStatePath);
const config = await readJsonFile(configPath);

const scrollSteps = clampInt(values.scroll, 120, 1, 2000);
const headless = values.headed ? false : true;

const executablePath = await pickChromiumExecutablePath({
  configChromePath: config?.chromePath
});
const browser = await chromium.launch({ headless, executablePath });
const context = await browser.newContext({
  storageState: hasStorageState ? storageStatePath : undefined,
  locale: 'zh-CN',
  timezoneId: 'Asia/Shanghai'
});

const page = await context.newPage();

const records = [];
const seen = new Set();

page.on('response', async (res) => {
  const url = res.url();
  if (!url.startsWith(API_PREFIX)) return;

  let body = null;
  try {
    body = await res.text();
  } catch {
    return;
  }

  const key = `${url}|${body.length}`;
  if (seen.has(key)) return;
  seen.add(key);

  records.push({
    url,
    status: res.status(),
    body
  });
});

try {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {});

  let stable = 0;
  let lastCount = records.length;

  for (let i = 0; i < scrollSteps; i += 1) {
    await page.mouse.wheel(0, 1200);
    await page.waitForTimeout(250);
    await page.waitForLoadState('networkidle', { timeout: 1500 }).catch(() => {});

    if (records.length === lastCount) stable += 1;
    else stable = 0;
    lastCount = records.length;

    if (stable >= 12) break;
  }
} finally {
  await context.close();
  await browser.close();
}

const content = buildOutput(records);
await fs.writeFile(outPath, content, 'utf8');
process.stdout.write(`${outPath}\n`);

function buildOutput(items) {
  if (!items.length) return 'NO_API_RESPONSE\n';
  const parts = [];
  for (let i = 0; i < items.length; i += 1) {
    const it = items[i];
    parts.push(`### ${i + 1} ${it.status} ${it.url}\n${it.body}`);
  }
  return `${parts.join('\n\n')}\n`;
}

function clampInt(raw, fallback, min, max) {
  const n = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}
