---
name: dylan-download-md-img
description: 将本地 Markdown 文件中的远程图片下载到本地目录，并回写图片链接为相对路径。适用于用户希望对已有 `.md` 执行“下载图片 / 本地化图片”的场景。支持受保护的飞书图片：cookie 优先级为 Markdown 头部注释 > CLI `--cookie` > `config.json`。
---

# dylan-download-md-img

## 何时使用

- 用户已经有本地 Markdown 文件，希望把其中的远程图片下载到本地，并替换 Markdown 里的图片链接为相对路径

## 入参

- `mdPath`（必填）：本地 Markdown 文件路径
- `--cookie "<cookie>"`（可选）：部分图片需要 Cookie 才能访问时使用；当 Markdown 头部已有 `dylan-download-md-img-cookie` 注释时，注释中的 cookie 优先
- `--concurrency <number>`（可选）：下载并发数，默认 `10`
- `--on-conflict <skip|overwrite|rename>`（可选）：目标图片重名时的处理策略，默认 `skip`
- 也可以通过 [config.json](./config.json) 提供默认值：
  - `cookie`：默认 Cookie（可选）；仅在 Markdown 头部注释和 CLI 都未提供时作为兜底
  - `concurrency`：下载并发数，默认 `10`
  - `onConflict`：目标图片重名时的处理策略，可选 `skip | overwrite | rename`，默认 `skip`

## 输出

- 若 Markdown 顶部 frontmatter 没有 `article_id`，会自动补一个
- 图片会下载到与 Markdown 同级的 `article_id/` 目录
- 如果目标文件已存在，默认跳过；也支持覆盖或自动重命名
- Markdown 中的远程图片链接会替换为 `article_id/img-xxx.<ext>` 相对路径
- stdout 单行输出 Markdown 文件路径
- stderr 会输出下载日志；当鉴权失败时，会尽量透传服务端返回的错误正文，方便定位 Cookie / 权限问题

## 调用

```bash
node skills/dylan-download-md-img/scripts/download_md_img.mjs "/abs/path/to/article.md"
```
