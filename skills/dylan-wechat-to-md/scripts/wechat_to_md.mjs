#!/usr/bin/env node
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  buildArticleId,
  extractWechatArticle,
  htmlToMarkdown,
  buildMarkdownDoc,
  pickOutDir,
  isProbablyWechatArticleUrl,
} from "./core.mjs";
import { fetchHtml, readJsonFile, writeMarkdownFile } from "./io.mjs";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: "string" },
    cookie: { type: "string" },
    "title-conflict": { type: "string" },
  },
});

const url = positionals[0];
if (!url) {
  console.error("缺少 URL 参数");
  process.exit(1);
}

if (!isProbablyWechatArticleUrl(url)) {
  console.error("URL 不是公众号文章链接(mp.weixin.qq.com/s/...)");
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

const cookie = values.cookie || config?.cookie || "";
const titleConflict = normalizeTitleConflict(
  values["title-conflict"] || config?.titleConflict || "skip",
);
const articleId = buildArticleId(url);
if (cookie) log("Cookie: 已提供");

const { outputPath, writeAction, title } = await collectWechatArticleToMarkdown(
  {
    url,
    outDir,
    cookie,
    titleConflict,
  },
);

log(`标题: ${title}`);

if (writeAction === "skipped") {
  log(`标题相同已存在，已跳过: ${outputPath}`);
  writeResult(outputPath, articleId);
  process.exit(0);
}

if (writeAction === "overwritten") log(`已覆盖`);
if (writeAction === "renamed") log(`标题冲突已重命名`);
if (writeAction === "created") log(`已保存`);

writeResult(outputPath, articleId);

async function collectWechatArticleToMarkdown({
  url,
  outDir,
  cookie,
  titleConflict,
}) {
  const fetchedAt = new Date().toISOString();

  log("抓取文章 HTML...");
  const html = await fetchHtml(
    url,
    cookie ? { headers: { cookie } } : undefined,
  );

  log("解析文章...");
  const article = extractWechatArticle(html, url);

  log("转换为 Markdown...");
  const contentMd = htmlToMarkdown(article.contentHtml);

  const doc = buildMarkdownDoc({
    title: article.title,
    sourceUrl: url,
    fetchedAt,
    contentMarkdown: contentMd,
  });

  const { path: outputPath, action: writeAction } = await writeMarkdownFile({
    outDir,
    title: article.title,
    markdown: doc,
    titleConflict,
  });

  return { outputPath, writeAction, title: article.title };
}

function normalizeTitleConflict(input) {
  const s = String(input || "")
    .trim()
    .toLowerCase();
  if (s === "skip" || s === "overwrite" || s === "rename") return s;
  console.error("参数错误: --title-conflict 仅支持 skip|overwrite|rename");
  process.exit(1);
}

function log(message) {
  process.stderr.write(`[wechat-to-md] ${message}\n`);
}

function writeResult(outputPath, articleId) {
  process.stdout.write(
    `${JSON.stringify({ path: outputPath, article_id: articleId })}\n`,
  );
}
