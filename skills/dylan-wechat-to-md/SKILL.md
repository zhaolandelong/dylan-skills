---
name: dylan-wechat-to-md
description: 当用户提到“收藏/下载”并提供微信公众号文章链接时使用。会把文章保存为本地 Markdown（可选下载图片），stdout 单行返回 .md 路径。
---

# dylan-wechat-to-md

## 何时使用

- 用户说“收藏/下载/保存”并提供公众号文章链接（`https://mp.weixin.qq.com/s/...`），希望把文章落到本地（主要场景：下载收藏）
- 用户给出公众号文章链接并希望导出为 Markdown

## 入参

- `url`（必填）：公众号文章 URL（`https://mp.weixin.qq.com/s/...`）
- `--out <dir>`（可选）：输出目录。支持相对路径/绝对路径/`~/...`；相对路径以当前工作目录为基准
- `--cookie "<cookie>"`（可选）：微信风控时用于携带登录态/验证态 Cookie
- `--download-images`（可选）：下载文章图片到本地，并把 Markdown 图片链接替换为相对路径

也可以通过 [config.json](file:///home/dylan/projects/dylan-skills/skills/dylan-wechat-to-md/config.json) 提供默认值：

- `outDir`：默认输出目录（当未传 `--out` 时生效）
- `cookie`：默认 Cookie（当未传 `--cookie` 时生效）
- `downloadImages`：是否下载图片（当未传 `--download-images` 时生效）

## 输出

- 写入一个 Markdown 文件到输出目录（文件名基于文章标题生成，若冲突则追加 `-2/-3/...`）
- Markdown 顶部包含 frontmatter：`article_id` / `title` / `source_url` / `fetched_at`
- 默认保留远程图片链接；当开启下载图片时，会在 Markdown 同级创建 `article_id` 同名目录存放图片，并把图片链接改为相对路径
- 成功时 stdout 输出生成的 Markdown 文件路径（单行）；失败时 stderr 输出错误信息并以非 0 退出码退出

## 调用

```bash
node skills/dylan-wechat-to-md/scripts/wechat_to_md.mjs "https://mp.weixin.qq.com/s/..."
```

```bash
node skills/dylan-wechat-to-md/scripts/wechat_to_md.mjs "https://mp.weixin.qq.com/s/PCBJlETTt_O3hmAau5eSvg" --out "/abs/path/to/dir" --cookie "key=value; ..." --download-images
```

## 当前限制

- 本期不实现登录态/付费文章的完整支持
