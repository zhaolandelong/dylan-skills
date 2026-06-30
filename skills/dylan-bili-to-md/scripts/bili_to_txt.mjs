#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
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
import { transcribeAudioWithOpenAICompatible } from "./asr.mjs";
import { resolveAsrOptions } from "./audio_to_md.mjs";
import { downloadBilibiliAudio } from "./bili_download_audio.mjs";
import { fetchJson, readJsonFile, resolveFinalUrl, writeTextFile } from "./io.mjs";

export async function main(argv = process.argv.slice(2)) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      out: { type: "string" },
      cookie: { type: "string" },
      "prefer-asr": { type: "boolean" },
      "base-url": { type: "string" },
      "api-key": { type: "string" },
      model: { type: "string" },
      lang: { type: "string" },
      prompt: { type: "string" },
      timeout: { type: "string" },
    },
  });

  const inputUrl = positionals[0];
  if (!inputUrl) {
    throw new Error("缺少 URL 参数");
  }

  if (!isProbablyBilibiliVideoUrl(inputUrl)) {
    throw new Error("URL 不是 B 站视频链接(bilibili.com/video/BV... 或 b23.tv/...)");
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
    throw new Error("缺少输出目录：请传 --out 或在 config.json 中设置 outDir");
  }

  const cookie = values.cookie || config?.cookie || "";
  if (cookie) log("Cookie: 已提供");
  const fetchedAt = new Date().toISOString();
  const asrOptions = resolveAsrOptions({ cliValues: values, configAsr: config?.asr });

  const normalizedUrl = await normalizeUrl(inputUrl, cookie);
  const { bvid, aid, p } = parseBilibiliVideoUrl(normalizedUrl);

  if (!bvid && !aid) {
    throw new Error("未能从 URL 解析出 BV 号/av 号");
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

  const subtitleState = await getSubtitles({
    aid: Number(view.data.aid || aid),
    bvid,
    cid,
    cookie,
  });

  const picked = pickPreferredSubtitle(subtitleState.subtitles);
  const contentMode = pickBiliContentMode({
    pickedSubtitle: picked,
    asrBaseUrl: asrOptions.baseUrl,
    preferAsr: values["prefer-asr"],
  });
  if (contentMode === "subtitle") {
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
    return;
  }

  if (contentMode === "asr") {
    const output = await transcribeFromAudioFallback({
      inputUrl: normalizedUrl,
      title,
      bvid: bvid || String(aid),
      cid,
      p,
      cookie,
      outDir,
      fetchedAt,
      asrOptions,
    });
    writeResult(output.path, bvid || String(aid), cid, output.lang, "asr");
    return;
  }

  throw new Error(subtitleState.reason);
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
  process.stderr.write(`[bili-to-md] ${message}\n`);
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
      return {
        subtitles: [],
        needLoginSubtitle,
        reason: "该视频字幕需要登录态，请通过 --cookie 或 config.json.cookie 提供 Cookie；若已配置 ASR，也可自动走音频转写",
      };
    }
    return {
      subtitles: [],
      needLoginSubtitle,
      reason:
        "未找到可用字幕（可能无字幕，或 Cookie 失效/权限不足）。当前可自动走音频下载 + ASR 转写；若未配置 ASR，可先手动下载音频，再用 dylan-bili-audio-to-md 转写",
    };
  }

  return { subtitles, needLoginSubtitle, reason: "" };
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

export function pickBiliContentMode({ pickedSubtitle, asrBaseUrl, preferAsr = false }) {
  if (preferAsr && String(asrBaseUrl || "").trim()) return "asr";
  if (pickedSubtitle?.url) return "subtitle";
  return String(asrBaseUrl || "").trim() ? "asr" : "none";
}

async function transcribeFromAudioFallback({
  inputUrl,
  title,
  bvid,
  cid,
  p,
  cookie,
  outDir,
  fetchedAt,
  asrOptions,
}) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "dylan-bili-asr-"));
  try {
    log("未命中可用字幕，回退到音频下载 + ASR...");
    const audioResult = await downloadBilibiliAudio({
      inputUrl,
      outDir: tempDir,
      cookie,
      logger: (message) => log(`audio: ${message}`),
    });
    const asrResult = await transcribeAudioWithOpenAICompatible({
      filePath: audioResult.path,
      baseUrl: asrOptions.baseUrl,
      apiKey: asrOptions.apiKey,
      model: asrOptions.model,
      language: asrOptions.language,
      prompt: asrOptions.prompt,
      timeoutMs: asrOptions.timeoutMs,
    });
    const lang = String(asrResult.language || asrOptions.language || "asr").trim() || "asr";
    const markdown = buildMarkdownDoc({
      title,
      sourceUrl: inputUrl,
      fetchedAt,
      contentMarkdown: asrResult.text,
      extraFields: {
        source_type: "bilibili-audio",
        transcribed_at: new Date().toISOString(),
        asr_backend: asrResult.backend,
        asr_model: asrResult.model,
        audio_stream_id: audioResult.audioId,
      },
    });
    const filename = buildOutputFilename({ title, p, lang: "asr" });
    const outputPath = await writeTextFile({ outDir, filename, text: markdown });
    return { path: outputPath, bvid, cid, lang };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}
