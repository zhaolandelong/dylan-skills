---
name: dylan-download-md-img
description: Downloads all remote images in a local Markdown file to a local folder and rewrites the image links. Invoke when user wants to "download images / localize images" for an existing .md.
---

# dylan-download-md-img

## 何时使用

- 用户已经有本地 Markdown 文件，希望把其中的远程图片下载到本地，并替换 Markdown 里的图片链接为相对路径

## 入参

- `mdPath`（必填）：本地 Markdown 文件路径
- `--cookie "<cookie>"`（可选）：部分图片需要 Cookie 才能访问时使用
- `--concurrency <number>`（可选）：下载并发数，默认 `10`
- 也可以通过 [config.json](./config.json) 提供默认值：`concurrency`：下载并发数，默认 `10`

## 输出

- 若 Markdown 顶部 frontmatter 没有 `article_id`，会自动补一个
- 图片会下载到与 Markdown 同级的 `article_id/` 目录
- Markdown 中的远程图片链接会替换为 `article_id/img-xxx.<ext>` 相对路径
- stdout 单行输出 Markdown 文件路径

## 调用

```bash
node skills/dylan-download-md-img/scripts/download_md_img.mjs "/abs/path/to/article.md"
```
