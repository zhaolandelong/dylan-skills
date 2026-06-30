#!/usr/bin/env node
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  buildMarkdownDoc,
  buildOutputFilename,
  encodeWbiParams,
  extractWbiKeys,
  isProbablyBilibiliVideoUrl,
  parseBilibiliVideoUrl,
  pickOutDir,
  pickPreferredSubtitle,
  subtitleBodyToPlainText,
} from "./core.mjs";
import { fetchJson, readJsonFile, resolveFinalUrl, writeTextFile } from "./io.mjs";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: "string" },
    cookie: { type: "string" },
  },
});

const inputUrl = positionals[0];
if (!inputUrl) {
  console.error("缺少 URL 参数");
  process.exit(1);
}

if (!isProbablyBilibiliVideoUrl(inputUrl)) {
  console.error("URL 不是 B 站视频链接(bilibili.com/video/BV... 或 b23.tv/...)");
  process.exit(1);
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(scriptDir, "..");
const configPath = path.join(skillRoot, "config.json");

const cwd = process.cwd();
const homeDir = os.homedir();

const config = await readJsonFile(configPath);
const outDir = pickOutDir({
  cliOutDir: values.out,
  configOutDir: config?.outDir,
  cwd,
  homeDir,
});

if (!outDir) {
  console.error("缺少输出目录：请传 --out 或在 config.json 中设置 outDir");
  process.exit(1);
}

const cookie = values.cookie || config?.cookie || "";
if (cookie) log("Cookie: 已提供");
const fetchedAt = new Date().toISOString();

const normalizedUrl = await normalizeUrl(inputUrl, cookie);
const { bvid, aid, p } = parseBilibiliVideoUrl(normalizedUrl);

if (!bvid && !aid) {
  console.error("未能从 URL 解析出 BV 号/av 号");
  process.exit(1);
}

log("获取视频信息...");
const view = await fetchJson(buildViewApiUrl({ bvid, aid }), {
  headers: cookie ? { cookie } : {},
});

if (view?.code !== 0 || !view?.data) {
  throw new Error(`获取视频信息失败: ${safeJson(view)}`);
}

const title = String(view.data.title || "").trim() || "bilibili-video";
const pages = Array.isArray(view.data.pages) ? view.data.pages : [];
const page = pages.find((x) => Number(x?.page) === p) || pages[0];
if (!page?.cid) {
  throw new Error("未找到 cid（可能是链接无效或视频结构异常）");
}

const cid = Number(page.cid);

const { subtitles, needLoginSubtitle } = await getSubtitles({
  aid: Number(view.data.aid || aid),
  bvid,
  cid,
  cookie,
});

const picked = pickPreferredSubtitle(subtitles);
if (!picked || !picked.url) {
  throw new Error(
    `字幕选择失败（字幕条目存在但缺少可下载地址）。摘要: ${summarizeSubtitles(subtitles)}`,
  );
}

log(`下载字幕: ${picked.lang} (${picked.source})...`);
const subtitleJson = await fetchJson(picked.url, {
  headers: cookie ? { cookie } : {},
});

const text = subtitleBodyToPlainText(subtitleJson?.body);
if (!text.trim()) {
  throw new Error("字幕内容为空");
}

const markdown = buildMarkdownDoc({
  title,
  sourceUrl: normalizedUrl,
  fetchedAt,
  contentMarkdown: text,
});
const filename = buildOutputFilename({ title, p, lang: picked.lang });
const outputPath = await writeTextFile({ outDir, filename, text: markdown });

writeResult(outputPath, bvid || String(aid), cid, picked.lang, picked.source);

async function normalizeUrl(url, cookie) {
  const u = new URL(url);
  if (u.hostname !== "b23.tv") return url;
  const finalUrl = await resolveFinalUrl(url, { headers: cookie ? { cookie } : {} });
  return finalUrl;
}

function buildViewApiUrl({ bvid, aid }) {
  if (bvid) return `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`;
  return `https://api.bilibili.com/x/web-interface/view?aid=${encodeURIComponent(String(aid))}`;
}

function buildNavApiUrl() {
  return "https://api.bilibili.com/x/web-interface/nav";
}

function buildPlayerApiUrl({ bvid, aid, cid }) {
  if (bvid) {
    return `https://api.bilibili.com/x/player/v2?bvid=${encodeURIComponent(
      bvid,
    )}&cid=${encodeURIComponent(String(cid))}`;
  }
  return `https://api.bilibili.com/x/player/v2?aid=${encodeURIComponent(
    String(aid),
  )}&cid=${encodeURIComponent(String(cid))}`;
}

function buildPlayerWbiApiUrl({ aid, cid, imgKey, subKey }) {
  const query = encodeWbiParams(
    {
      aid: String(aid),
      cid: String(cid),
      isGaiaAvoided: 'false',
      web_location: '1315873',
    },
    { imgKey, subKey },
  );
  return `https://api.bilibili.com/x/player/wbi/v2?${query}`;
}

function log(message) {
  process.stderr.write(`[bli-to-md] ${message}\n`);
}

function writeResult(outputPath, bvid, cid, lang, source) {
  process.stdout.write(
    `${JSON.stringify({ path: outputPath, bvid, cid, lang, source })}\n`,
  );
}

function safeJson(v) {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

async function getSubtitles({ aid, bvid, cid, cookie }) {
  const wbi = await tryFetchWbiSubtitles({ aid, cid, cookie });
  if (wbi.subtitles.length) return wbi;

  log("回退到 x/player/v2...");
  const player = await fetchJson(buildPlayerApiUrl({ bvid, aid, cid }), {
    headers: cookie ? { cookie } : {},
  });

  if (player?.code !== 0 || !player?.data) {
    throw new Error(`获取字幕列表失败: ${safeJson(player)}`);
  }

  const subtitles = player.data?.subtitle?.subtitles || [];
  const needLoginSubtitle = Boolean(player.data?.need_login_subtitle);

  if (!subtitles.length) {
    if (wbi.error) {
      log(`wbi 接口失败: ${wbi.error}`);
    }
    if (needLoginSubtitle && !cookie) {
      throw new Error("该视频字幕需要登录态，请通过 --cookie 或 config.json.cookie 提供 Cookie");
    }
    throw new Error("未找到可用字幕（可能无字幕，或 Cookie 失效/权限不足）");
  }

  return { subtitles, needLoginSubtitle };
}

async function tryFetchWbiSubtitles({ aid, cid, cookie }) {
  try {
    log("获取 WBI 字幕列表...");
    const nav = await fetchJson(buildNavApiUrl(), {
      headers: cookie ? { cookie } : {},
    });
    const keys = extractWbiKeys(nav?.data);
    if (!keys) {
      return { subtitles: [], needLoginSubtitle: false, error: "nav 缺少 wbi keys" };
    }

    const player = await fetchJson(buildPlayerWbiApiUrl({ aid, cid, ...keys }), {
      headers: cookie ? { cookie } : {},
    });

    if (player?.code !== 0 || !player?.data) {
      return { subtitles: [], needLoginSubtitle: false, error: safeJson(player) };
    }

    return {
      subtitles: player.data?.subtitle?.subtitles || [],
      needLoginSubtitle: Boolean(player.data?.need_login_subtitle),
      error: "",
    };
  } catch (error) {
    return {
      subtitles: [],
      needLoginSubtitle: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function summarizeSubtitles(subtitles) {
  const list = Array.isArray(subtitles) ? subtitles : [];
  const brief = list.slice(0, 6).map((s) => {
    const lan = String(s?.lan || '').trim() || 'unknown';
    const t = s?.subtitle_type ?? s?.type ?? null;
    const hasUrl = Boolean(String(s?.url || '').trim());
    const hasSubtitleUrl = Boolean(String(s?.subtitle_url || '').trim());
    const isLock = Boolean(s?.is_lock);
    return { lan, type: t, hasUrl, hasSubtitleUrl, isLock };
  });
  return JSON.stringify({ total: list.length, items: brief });
}
