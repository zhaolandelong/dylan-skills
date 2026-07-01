---
name: dylan-bili-to-md
description: 当用户提供 B 站视频链接并希望“下载/保存字幕”，或手动提供本地音频/视频文件并希望“转成文字 Markdown”时使用。字幕链路优先消费现成字幕；音频链路通过 OpenAI 兼容 ASR 服务转写。
---

# dylan-bili-to-md

## 能力

### 1. 视频 / 合集 URL -> 字幕优先，失败自动回退音频 ASR

- `url`（必填）：B 站视频或合集 URL
- 支持：`bilibili.com/video/BV...`、`b23.tv/...`、`space.bilibili.com/<mid>/lists/<season_id>`
- `--out <dir>`（可选）：输出目录。未传时使用 `config.json.outDir`
- `--cookie "<cookie>"`（可选）：需要登录态才能获取字幕时使用；也可写入 `config.json.cookie`
- `--base-url <url>` / `--model <name>` / `--api-key <key>` / `--lang <code>`（可选）：当视频无字幕时自动回退到音频下载 + ASR
- `--prefer-asr`（可选）：忽略现成字幕，直接走音频下载 + ASR；便于测试完整链路

输出：

- 单视频：写入一个 `.md` 到输出目录
- 合集：逐个视频写入 `.md`，stdout 返回 `items` 数组
- 文件开头包含 frontmatter：`article_id` / `title` / `source_url` / `fetched_at`
- stdout：单行 JSON：`{"path":"...","bvid":"...","cid":123,"lang":"...","source":"cc|ai|asr"}` 或 `{"mode":"collection","count":8,"items":[...]}`

调用：

```bash
node skills/dylan-bili-to-md/scripts/bili_to_txt.mjs "https://www.bilibili.com/video/BV..."
```

```bash
node skills/dylan-bili-to-md/scripts/bili_to_txt.mjs "https://space.bilibili.com/504934876/lists/7638935"
```

### 2. 视频 URL -> 下载音频并转 m4a

- `url`（必填）：B 站视频 URL（支持 `bilibili.com/video/BV...` 与 `b23.tv/...`）
- `--out <dir>`（可选）：输出目录。未传时使用 `config.json.outDir`
- `--cookie "<cookie>"`（可选）：需要登录态时使用；也可写入 `config.json.cookie`

输出：

- 下载原始音频流为 `.m4s`
- 再转出一个 `.m4a`
- stdout：单行 JSON：`{"path":"...m4a","rawPath":"...m4s","bvid":"...","cid":123,"audioId":30280,"source":"dash-audio"}`

调用：

```bash
node skills/dylan-bili-to-md/scripts/bili_download_audio.mjs "https://www.bilibili.com/video/BV..."
```

### 3. 本地媒体文件 -> ASR Markdown

- `input`（必填）：本地媒体文件路径
- 支持格式：`.m4s` `.m4a` `.mp3` `.wav` `.mp4` `.webm`
- `--out <dir>`（可选）：输出目录。未传时使用 `config.json.outDir`
- `--title "<title>"`（可选）：覆盖默认标题；默认取文件名
- `--base-url <url>`（可选）：OpenAI 兼容 ASR 服务地址；也可写入 `config.json.asr.baseUrl`
- `--api-key <key>`（可选）：ASR 服务 API Key；也可写入 `config.json.asr.apiKey`
- `--model <name>`（可选）：ASR 模型；默认读取 `config.json.asr.model`
- `--lang <code>`（可选）：语言提示；默认读取 `config.json.asr.language`

输出：

- 写入一个 `.md` 到输出目录
- frontmatter 包含：`article_id` / `title` / `source_file` / `source_type` / `transcribed_at` / `asr_backend` / `asr_model`
- stdout：单行 JSON：`{"path":"...","input":"...","mode":"asr","backend":"openai-compatible","model":"..."}`

调用：

```bash
node skills/dylan-bili-to-md/scripts/audio_to_md.mjs "/path/to/audio.m4s"
```

## 推荐工作流

1. 直接执行 `dylan-bili-to-md <url>`。
2. 若是单视频，脚本直接处理该视频；若是合集，脚本会逐个处理合集下所有视频。
3. 有字幕时优先落现成字幕；无字幕且已配置 ASR 时自动下载音频并转写。
4. 需要单独排查音频或手动转写时，再使用 `dylan-bili-download-audio` / `dylan-bili-audio-to-md`。

## 前置依赖

- 下载音频并转 `.m4a` 依赖系统已安装 `ffmpeg`
- `.m4s` 输入依赖系统已安装 `ffmpeg`
- 音频转写依赖一个 OpenAI 兼容的 ASR 服务地址
