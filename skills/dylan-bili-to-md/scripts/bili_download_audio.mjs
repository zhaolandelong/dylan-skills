#!/usr/bin/env node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import {
  filenameBaseFromTitle,
  isProbablyBilibiliCheeseUrl,
  isProbablyBilibiliVideoUrl,
  parseBilibiliCheeseUrl,
  parseBilibiliVideoUrl,
  pickOutDir,
} from './core.mjs';
import { fetchBuffer, fetchJson, readJsonFile, resolveFinalUrl } from './io.mjs';
import { concatM4aFiles, convertMediaToM4a } from './media.mjs';

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
  const isVideoUrl = isProbablyBilibiliVideoUrl(inputUrl);
  const isCheeseUrl = isProbablyBilibiliCheeseUrl(inputUrl);
  if (!isVideoUrl && !isCheeseUrl) {
    throw new Error('URL 不是支持的 B 站链接（video 或 cheese）');
  }

  if (isCheeseUrl) {
    return await downloadBilibiliCheeseAudio({ inputUrl, outDir, cookie, logger });
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
  if (!isProbablyBilibiliVideoUrl(inputUrl) && !isProbablyBilibiliCheeseUrl(inputUrl)) {
    throw new Error('URL 不是支持的 B 站链接（video 或 cheese）');
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

function buildPugvSeasonApiUrl({ epId, seasonId }) {
  const u = new URL('https://api.bilibili.com/pugv/view/web/season');
  if (seasonId) u.searchParams.set('season_id', String(seasonId));
  else u.searchParams.set('ep_id', String(epId));
  return u.toString();
}

function buildPugvPlayurlApiUrl({ aid, epId, cid, qn = 32 }) {
  const u = new URL('https://api.bilibili.com/pugv/player/web/playurl');
  u.searchParams.set('avid', String(aid));
  u.searchParams.set('ep_id', String(epId));
  u.searchParams.set('cid', String(cid));
  u.searchParams.set('qn', String(qn));
  return u.toString();
}

function buildPugvPlayurlApiUrlDash({ aid, epId, cid, qn = 32 }) {
  const u = new URL('https://api.bilibili.com/pugv/player/web/playurl');
  u.searchParams.set('avid', String(aid));
  u.searchParams.set('ep_id', String(epId));
  u.searchParams.set('cid', String(cid));
  u.searchParams.set('qn', String(qn));
  u.searchParams.set('fnver', '0');
  u.searchParams.set('fnval', '16');
  u.searchParams.set('fourk', '0');
  u.searchParams.set('from_client', 'BROWSER');
  u.searchParams.set('drm_tech_type', '2');
  return u.toString();
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

async function downloadBilibiliCheeseAudio({ inputUrl, outDir, cookie, logger }) {
  const trimmedCookie = String(cookie || '').trim();
  if (!trimmedCookie) {
    throw new Error('课程下载需要登录态，请通过 --cookie 或 config.json.cookie 提供 Cookie');
  }

  const { epId, seasonId } = parseBilibiliCheeseUrl(inputUrl);
  if (!epId && !seasonId) {
    throw new Error('未能从课程链接解析出 ep_id/season_id');
  }

  const headers = { cookie: trimmedCookie, referer: 'https://www.bilibili.com/' };

  logger('获取课程信息...');
  const season = await fetchJson(buildPugvSeasonApiUrl({ epId, seasonId }), { headers });
  if (season?.code !== 0 || !season?.data) {
    throw new Error(`获取课程信息失败: ${safeJson(season)}`);
  }

  const courseTitle = String(season.data?.title || '').trim() || 'bilibili-cheese';
  const episodes = Array.isArray(season.data?.episodes) ? season.data.episodes : [];
  if (!episodes.length) {
    throw new Error('课程下未找到分集');
  }

  const episode =
    (epId ? episodes.find((e) => Number(e?.id) === Number(epId)) : null) || episodes[0];
  const resolvedEpId = Number(episode?.id);
  const aid = Number(episode?.aid);
  const cid = Number(episode?.cid);
  if (!resolvedEpId || !aid || !cid) {
    throw new Error('课程分集缺少必要字段（id/aid/cid）');
  }

  const index = String(episode?.index ?? '').trim();
  const epTitle = String(episode?.title || '').trim() || `ep${resolvedEpId}`;
  const title = `${courseTitle} - ${index ? `${index} - ` : ''}${epTitle}`.trim();

  await fs.mkdir(outDir, { recursive: true });

  logger('获取播放信息...');
  const dashFirst = await fetchJson(buildPugvPlayurlApiUrlDash({ aid, epId: resolvedEpId, cid }), {
    headers,
  });
  let playurl = dashFirst;
  if (dashFirst?.code === -400 && String(dashFirst?.message || '').toLowerCase().includes('not dash')) {
    playurl = await fetchJson(buildPugvPlayurlApiUrl({ aid, epId: resolvedEpId, cid }), { headers });
  }
  if (playurl?.code !== 0 || !playurl?.data) {
    throw new Error(`获取播放信息失败: ${safeJson(playurl)}`);
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dylan-bili-cheese-audio-'));
  try {
    const dashAudio = pickPreferredDashAudio(playurl.data?.dash?.audio);
    if (dashAudio) {
      const audioUrl = String(dashAudio.baseUrl || dashAudio.base_url || '').trim();
      if (!audioUrl) {
        throw new Error('播放信息中未找到可用音频流 url');
      }

      const baseName = buildDownloadedAudioBasename({ title, p: 1, audioId: dashAudio.id });
      const rawPath = path.join(tempDir, `${baseName}.m4s`);
      const finalM4aPath = path.join(outDir, `${baseName}.m4a`);

      logger(`下载音频流: ${dashAudio.id || 'unknown'}...`);
      const { buffer } = await fetchBuffer(audioUrl, { headers });
      await fs.writeFile(rawPath, buffer);

      logger('转 m4a...');
      await convertMediaToM4a({ inputPath: rawPath, outputPath: finalM4aPath });

      return {
        path: finalM4aPath,
        rawPath,
        bvid: `pugv-ep${resolvedEpId}`,
        cid,
        audioId: Number(dashAudio.id || 0) || null,
        source: 'pugv-dash-audio',
        title,
        p: 1,
        url: `https://www.bilibili.com/cheese/play/ep${resolvedEpId}`,
        epId: resolvedEpId,
        aid,
      };
    }

    const durl = Array.isArray(playurl.data?.durl) ? playurl.data.durl : [];
    if (!durl.length) {
      throw new Error('播放信息中未找到可用视频流(durl/dash)');
    }

    const segmentM4as = [];
    let order = 0;
    for (const seg of durl) {
      order += 1;
      const segUrl = String(seg?.url || '').trim();
      if (!segUrl) continue;
      const rawPath = path.join(tempDir, `seg-${order}.mp4`);
      const m4aPath = path.join(tempDir, `seg-${order}.m4a`);
      logger(`下载视频分段: ${order}/${durl.length}...`);
      const { buffer } = await fetchBuffer(segUrl, { headers });
      await fs.writeFile(rawPath, buffer);
      logger(`抽取音频: ${order}/${durl.length}...`);
      await convertMediaToM4a({ inputPath: rawPath, outputPath: m4aPath });
      segmentM4as.push(m4aPath);
    }

    if (!segmentM4as.length) {
      throw new Error('未能下载任何分段');
    }

    const baseName = buildDownloadedAudioBasename({ title, p: 1, audioId: null });
    const finalM4aPath = path.join(outDir, `${baseName}.m4a`);
    await concatM4aFiles({ inputPaths: segmentM4as, outputPath: finalM4aPath });

    return {
      path: finalM4aPath,
      rawPath: '',
      bvid: `pugv-ep${resolvedEpId}`,
      cid,
      audioId: null,
      source: 'pugv-durl',
      title,
      p: 1,
      url: `https://www.bilibili.com/cheese/play/ep${resolvedEpId}`,
      epId: resolvedEpId,
      aid,
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
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
