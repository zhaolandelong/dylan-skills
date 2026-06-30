---
name: dylan-bili-to-md
description: 当用户提供 B 站视频链接并希望“下载/保存字幕”时使用。会把现成字幕保存为本地 Markdown，stdout 单行返回包含 path/bvid/cid/lang/source 的 JSON。
---

# dylan-bili-to-md

## 入参

- `url`（必填）：B 站视频 URL（支持 `bilibili.com/video/BV...` 与 `b23.tv/...`）
- `--out <dir>`（可选）：输出目录。未传时使用 `config.json.outDir`
- `--cookie "<cookie>"`（可选）：需要登录态才能获取字幕时使用；也可写入 `config.json.cookie`

## 输出

- 写入一个 `.md` 到输出目录
- 文件开头包含 frontmatter：`article_id` / `title` / `source_url` / `fetched_at`
- stdout：单行 JSON：`{"path":"...","bvid":"...","cid":123,"lang":"...","source":"cc|ai"}`

## 调用

```bash
node skills/dylan-bili-to-md/scripts/bili_to_txt.mjs "https://www.bilibili.com/video/BV..."
```
