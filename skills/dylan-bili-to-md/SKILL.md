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

## 执行协议

调用本 skill 时，必须按下面顺序执行，不能跳过“字幕二次整理”。

1. 先判断输入类型：
   - B 站视频 / 合集 URL：走 `bili_to_txt.mjs`
   - 本地媒体文件：走 `audio_to_md.mjs`
2. 产出初稿：
   - 有现成字幕时，优先使用现成字幕生成 Markdown
   - 无现成字幕时，若已提供或已配置 ASR 参数，则下载音频并转写生成 Markdown
   - 若既无现成字幕也无可用 ASR 配置，明确报错，不要伪造完成结果
3. 读取刚生成的 Markdown 文件内容。
4. 对正文执行一次[字幕二次整理](#字幕二次整理)：
   - 补标点
   - 按语义分段
   - 修正少量明显识别错误
   - 保留 frontmatter 和已有 Markdown 结构
5. 把整理后的内容直接覆盖写回原 `.md` 文件。
6. 只在覆盖写回完成后，才向调用方返回成功结果。

补充约束：

- “生成初稿”不等于任务完成；必须完成“二次整理 + 覆盖回写”后才算完成
- 合集模式下，对 `items` 中每个生成的文件都要分别执行完整的“生成初稿 -> 二次整理 -> 覆盖回写”流程
- 只有当用户明确要求“备份原文件”或当前任务本身是调试备份逻辑时，才额外生成备份文件
- 需要单独排查音频或手动转写时，再使用 `bili_download_audio.mjs` / `audio_to_md.mjs`

## 字幕二次整理

当输出的 md 属于“逐字稿风格”（常见为一句一行、几乎无标点、无段落，或仅少量断句但无段落且有少量识别错误），必须按以下规则整理后再交付。不要把未经整理的逐字稿直接当成最终结果。

### 目标

- 补标点：`，。！？；：` 为主，避免全篇无标点或标点过密
- 分段：按语义自然分段，段落之间空一行，不要每句一行
- 纠错：只修“显然错”的错别字/同音字/名词误识别，尽量不改原意；不扩写、不总结、不补事实

### 处理规则

- 若文件以 YAML frontmatter 开头（`---` ... `---`），必须原样保留；只处理正文
- 保留已有 Markdown 结构（标题/列表/代码块/链接/图片/URL）；仅对纯文本段落做断句、分段与纠错
- 关键保护：数字/日期/金额/单位/公式/代码/URL/邮箱 不要随意改动
- 若正文本身已经可读、标点和段落基本正常，只做最小必要修正；不要过度改写
- 不要新增总结、标题、目录、免责声明、说明文字；只整理已有正文内容

### 覆盖策略（默认：直接覆盖，不备份）

默认直接覆盖原文件，不额外生成 `bak-*`、`*.polished.md` 或其他副本，只保留一个最终 `.md` 文件。

只有当用户明确提出“保留备份”“另存一份”“不要覆盖原文件”等要求时，才允许额外生成副本。

推荐落盘顺序：

1. 先在内存中完成正文整理
2. 再一次性覆盖写回原文件
3. 写回成功后返回结果

## 前置依赖

- 下载音频并转 `.m4a` 依赖系统已安装 `ffmpeg`
- `.m4s` 输入依赖系统已安装 `ffmpeg`
- 音频转写依赖一个 OpenAI 兼容的 ASR 服务地址
