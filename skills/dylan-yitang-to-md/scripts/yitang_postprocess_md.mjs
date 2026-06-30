#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFrontmatter, filenameBaseFromTitle, stripGridLayoutTags } from './core.mjs';

export function extractTitle(markdown) {
  const match = String(markdown || '').match(/^\s*<title>([\s\S]*?)<\/title>\s*/i);
  return String(match?.[1] || '').trim();
}

export function stripLeadingTitleTag(markdown) {
  return String(markdown || '').replace(/^\s*<title>[\s\S]*?<\/title>\s*/i, '');
}

export function stripImageAltText(markdown) {
  return String(markdown || '').replace(/!\[(?:\\.|[^\]\\])*\]\(([^)\r\n]+)\)/g, '![]($1)');
}

export function rewriteFeishuImageUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return raw;

  try {
    const parsed = new URL(raw);
    const hostname = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname;

    const fileMatch = pathname.match(/^\/file\/(box[a-zA-Z0-9]+)\/?$/);
    if ((hostname === 'feishu.cn' || hostname.endsWith('.feishu.cn')) && fileMatch) {
      return `https://internal-api-drive-stream.feishu.cn/space/api/box/stream/download/v2/cover/${fileMatch[1]}/`;
    }

    const coverMatch = pathname.match(/^\/space\/api\/box\/stream\/download\/v2\/cover\/(box[a-zA-Z0-9]+)\/?$/);
    if (hostname === 'internal-api-drive-stream.feishu.cn' && coverMatch) {
      return `https://internal-api-drive-stream.feishu.cn/space/api/box/stream/download/v2/cover/${coverMatch[1]}/`;
    }

    return raw;
  } catch {
    return raw;
  }
}

export function rewriteMarkdownImageUrls(markdown) {
  return String(markdown || '').replace(/!\[((?:\\.|[^\]\\])*)\]\(([^)\r\n]+)\)/g, (_match, alt, url) => {
    return `![${alt}](${rewriteFeishuImageUrl(url)})`;
  });
}

export function buildFallbackArticleId(inputPath) {
  const normalized = String(inputPath || '').trim();
  const safe = Buffer.from(normalized).toString('base64url').slice(0, 18) || 'local';
  return `yt-local-${safe}`;
}

export function buildAlignedFrontmatter({ title, sourceUrl, fetchedAt, inputPath }) {
  const normalizedSourceUrl = String(sourceUrl || '').trim();
  const normalizedFetchedAt = String(fetchedAt || '').trim();

  if (normalizedSourceUrl) {
    return buildFrontmatter({
      title,
      sourceUrl: normalizedSourceUrl,
      fetchedAt: normalizedFetchedAt || new Date().toISOString()
    });
  }

  return [
    '---',
    `article_id: ${JSON.stringify(buildFallbackArticleId(inputPath))}`,
    `title: ${JSON.stringify(String(title || '').trim())}`,
    `source_url: ${JSON.stringify('')}`,
    `fetched_at: ${JSON.stringify(normalizedFetchedAt || new Date().toISOString())}`,
    '---',
    ''
  ].join('\n');
}

export function transformMarkdown(
  markdown,
  { inputPath, sourceUrl = '', fetchedAt = '', stripImageAlt = false } = {}
) {
  const title = extractTitle(markdown);
  if (!title) {
    throw new Error('未找到 <title> 标签，无法生成目标文件名');
  }

  const strippedTitle = stripLeadingTitleTag(markdown);
  const rewritten = rewriteMarkdownImageUrls(strippedTitle);
  const normalized = stripGridLayoutTags(rewritten);
  const body = (stripImageAlt ? stripImageAltText(normalized) : normalized).trimStart();
  const frontmatter = buildAlignedFrontmatter({ title, sourceUrl, fetchedAt, inputPath });
  const output = `${frontmatter}${body}`.replace(/\s+$/u, '') + '\n';
  const filename = `${filenameBaseFromTitle(title)}.md`;

  return { title, filename, content: output };
}

async function main() {
  const { inputPath, outputDir, sourceUrl, fetchedAt, stripImageAlt } = parseArgs(process.argv.slice(2));
  const input = await fs.readFile(inputPath, 'utf8');
  const transformed = transformMarkdown(input, {
    inputPath,
    sourceUrl,
    fetchedAt,
    stripImageAlt
  });

  await fs.mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, transformed.filename);
  await fs.writeFile(outputPath, transformed.content, 'utf8');
  process.stdout.write(`${outputPath}\n`);
}

function parseArgs(argv) {
  const args = [...argv];
  const inputPath = args.shift();
  if (!inputPath) {
    throw new Error('缺少输入文件路径');
  }

  let outputDir = path.dirname(path.resolve(inputPath));
  let sourceUrl = '';
  let fetchedAt = '';
  let stripImageAlt = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--out-dir') {
      outputDir = path.resolve(args[i + 1] || '');
      i += 1;
      continue;
    }
    if (arg === '--source-url') {
      sourceUrl = String(args[i + 1] || '');
      i += 1;
      continue;
    }
    if (arg === '--fetched-at') {
      fetchedAt = String(args[i + 1] || '');
      i += 1;
      continue;
    }
    if (arg === '--strip-image-alt') {
      stripImageAlt = true;
      continue;
    }
    throw new Error(`不支持的参数: ${arg}`);
  }

  return {
    inputPath: path.resolve(inputPath),
    outputDir,
    sourceUrl,
    fetchedAt,
    stripImageAlt
  };
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  await main();
}
