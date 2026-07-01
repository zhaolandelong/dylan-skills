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
5. 按照[字幕二次整理](#字幕二次整理)规则，二次整理为可读文本。

## 字幕二次整理

当输出的 md 属于“逐字稿风格”（常见为一句一行、几乎无标点、无段落，或仅少量断句但无段落且有少量识别错误），按以下规则二次整理为可读文本。

### 目标

- 补标点：`，。！？；：` 为主，避免全篇无标点或标点过密
- 分段：按语义自然分段，段落之间空一行，不要每句一行
- 纠错：只修“显然错”的错别字/同音字/名词误识别，尽量不改原意；不扩写、不总结、不补事实

### 处理规则

- 若文件以 YAML frontmatter 开头（`---` ... `---`），必须原样保留；只处理正文
- 保留已有 Markdown 结构（标题/列表/代码块/链接/图片/URL）；仅对纯文本段落做断句、分段与纠错
- 关键保护：数字/日期/金额/单位/公式/代码/URL/邮箱 不要随意改动

### 覆盖策略（固定：覆盖 + 备份）

默认直接覆盖原文件，但在同目录先备份一份，文件名加 `bak-` 前缀（例如 `bak-xxx.md`）。

推荐落盘顺序：先生成 `xxx.polished.md`，再把原文件改名为备份，最后用润色版覆盖回原文件名（避免中途失败导致原文件损坏）。

- Bash（Linux/macOS/WSL/Git Bash）：
  - `mv "xxx.md" "bak-xxx.md" && mv -f "xxx.polished.md" "xxx.md"`
- Windows CMD：
  - `move "xxx.md" "bak-xxx.md" && move /Y "xxx.polished.md" "xxx.md"`

## 前置依赖

- 下载音频并转 `.m4a` 依赖系统已安装 `ffmpeg`
- `.m4s` 输入依赖系统已安装 `ffmpeg`
- 音频转写依赖一个 OpenAI 兼容的 ASR 服务地址
