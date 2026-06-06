#!/usr/bin/env node
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { extractWechatArticle, htmlToMarkdown, buildMarkdownDoc, pickOutDir, isProbablyWechatArticleUrl } from './core.mjs';
import { fetchHtml, readJsonFile, writeMarkdownFile } from './io.mjs';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: 'string' },
    cookie: { type: 'string' }
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

const fetchedAt = new Date().toISOString();
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

process.stdout.write(`${outputPath}\n`);
