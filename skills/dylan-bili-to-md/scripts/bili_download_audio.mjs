#!/usr/bin/env node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import {
  filenameBaseFromTitle,
  isProbablyBilibiliVideoUrl,
  parseBilibiliVideoUrl,
  pickOutDir,
} from './core.mjs';
import { fetchBuffer, fetchJson, readJsonFile, resolveFinalUrl } from './io.mjs';
import { convertMediaToM4a } from './media.mjs';

export function extractPlayinfoFromHtml(html) {
  const source = String(html || '');
  const match = source.match(/__playinfo__=([\s\S]*?)<\/script>/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

export function pickPreferredDashAudio(audioList) {
  const items = Array.isArray(audioList) ? audioList : [];
  if (!items.length) return null;
  return [...items]
    .filter((item) => String(item?.baseUrl || item?.base_url || '').trim())
    .sort((a, b) => {
      const bandwidthDiff = Number(b?.bandwidth || 0) - Number(a?.bandwidth || 0);
      if (bandwidthDiff !== 0) return bandwidthDiff;
      return Number(b?.id || 0) - Number(a?.id || 0);
    })[0] || null;
}

export function buildDownloadedAudioBasename({ title, p, audioId }) {
  const safeTitle = filenameBaseFromTitle(title);
  const partSuffix = p && p > 1 ? `-p${p}` : '';
  const audioSuffix = audioId ? `-audio-${audioId}` : '-audio';
  return `${safeTitle}${partSuffix}${audioSuffix}`;
}

export async function downloadBilibiliAudio({
  inputUrl,
  outDir,
  cookie = '',
  logger = log,
}) {
  if (!inputUrl) {
    throw new Error('缺少 URL 参数');
  }
  if (!isProbablyBilibiliVideoUrl(inputUrl)) {
    throw new Error('URL 不是 B 站视频链接(bilibili.com/video/BV... 或 b23.tv/...)');
  }

  const headers = cookie ? { cookie } : {};
  const normalizedUrl = await normalizeUrl(inputUrl, cookie);
  const { bvid, aid, p } = parseBilibiliVideoUrl(normalizedUrl);
  if (!bvid && !aid) {
    throw new Error('未能从 URL 解析出 BV 号/av 号');
  }

  logger('获取视频信息...');
  const view = await fetchJson(buildViewApiUrl({ bvid, aid }), { headers });
  if (view?.code !== 0 || !view?.data) {
    throw new Error(`获取视频信息失败: ${safeJson(view)}`);
  }

  const title = String(view.data.title || '').trim() || 'bilibili-video';
  const pages = Array.isArray(view.data.pages) ? view.data.pages : [];
  const page = pages.find((item) => Number(item?.page) === p) || pages[0];
  if (!page?.cid) {
    throw new Error('未找到 cid（可能是链接无效或视频结构异常）');
  }

  logger('获取播放信息...');
  const pageHtml = await fetchPageHtml(normalizedUrl, headers);
  const playinfo = extractPlayinfoFromHtml(pageHtml);
  const audio = pickPreferredDashAudio(playinfo?.data?.dash?.audio);
  if (!audio) {
    throw new Error('页面中未找到可用音频流');
  }

  const audioUrl = String(audio.baseUrl || audio.base_url || '').trim();
  const baseName = buildDownloadedAudioBasename({ title, p, audioId: audio.id });
  const rawPath = path.join(outDir, `${baseName}.m4s`);
  const m4aPath = path.join(outDir, `${baseName}.m4a`);

  await fs.mkdir(outDir, { recursive: true });
  logger(`下载音频流: ${audio.id || 'unknown'}...`);
  const { buffer } = await fetchBuffer(audioUrl, { headers });
  await fs.writeFile(rawPath, buffer);

  logger('转 m4a...');
  await convertMediaToM4a({ inputPath: rawPath, outputPath: m4aPath });

  return {
    path: m4aPath,
    rawPath,
    bvid: bvid || String(aid),
    cid: Number(page.cid),
    audioId: Number(audio.id || 0) || null,
    source: 'dash-audio',
    title,
    p,
    url: normalizedUrl,
  };
}

export async function main(argv = process.argv.slice(2)) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      out: { type: 'string' },
      cookie: { type: 'string' },
    },
  });

  const inputUrl = positionals[0];
  if (!inputUrl) {
    throw new Error('缺少 URL 参数');
  }
  if (!isProbablyBilibiliVideoUrl(inputUrl)) {
    throw new Error('URL 不是 B 站视频链接(bilibili.com/video/BV... 或 b23.tv/...)');
  }

  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const skillRoot = path.resolve(scriptDir, '..');
  const config = await readJsonFile(path.join(skillRoot, 'config.json'));

  const outDir = pickOutDir({
    cliOutDir: values.out,
    configOutDir: config?.outDir,
    cwd: process.cwd(),
    homeDir: os.homedir(),
  });
  if (!outDir) {
    throw new Error('缺少输出目录：请传 --out 或在 config.json 中设置 outDir');
  }

  const cookie = String(values.cookie || config?.cookie || '').trim();
  const result = await downloadBilibiliAudio({ inputUrl, outDir, cookie });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

async function normalizeUrl(url, cookie) {
  const parsed = new URL(url);
  if (parsed.hostname !== 'b23.tv') return url;
  return await resolveFinalUrl(url, { headers: cookie ? { cookie } : {} });
}

function buildViewApiUrl({ bvid, aid }) {
  if (bvid) return `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`;
  return `https://api.bilibili.com/x/web-interface/view?aid=${encodeURIComponent(String(aid))}`;
}

async function fetchPageHtml(url, headers) {
  const { buffer } = await fetchBuffer(url, { headers });
  return buffer.toString('utf8');
}

function log(message) {
  process.stderr.write(`[bili-download-audio] ${message}\n`);
}

function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function isMainModule() {
  const entry = process.argv[1];
  if (!entry) return false;
  return pathToFileURL(path.resolve(entry)).href === import.meta.url;
}

if (isMainModule()) {
  await main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
