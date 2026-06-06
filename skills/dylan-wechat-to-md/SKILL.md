---
name: dylan-wechat-to-md
description: 当用户提供微信公众号文章链接并希望导出为 Markdown 时使用。输出为本地 .md 文件路径（stdout 单行返回）。
---

# dylan-wechat-to-md

## 何时使用

- 用户给出公众号文章链接（`https://mp.weixin.qq.com/s/...`），希望转换成 Markdown 并保存到本地
- 用户提到“公众号文章转 md / 导出 markdown / 保存为 .md”

## 入参

- `url`（必填）：公众号文章 URL（`https://mp.weixin.qq.com/s/...`）
- `--out <dir>`（可选）：输出目录。支持相对路径/绝对路径/`~/...`；相对路径以当前工作目录为基准
- `--cookie "<cookie>"`（可选）：微信风控时用于携带登录态/验证态 Cookie

也可以通过 [config.json](file:///home/dylan/projects/dylan-skills/skills/dylan-wechat-to-md/config.json) 提供默认值：

- `outDir`：默认输出目录（当未传 `--out` 时生效）
- `cookie`：默认 Cookie（当未传 `--cookie` 时生效）

## 输出

- 写入一个 Markdown 文件到输出目录（文件名基于文章标题生成，若冲突则追加 `-2/-3/...`）
- Markdown 顶部包含 frontmatter：`title` / `source_url` / `fetched_at`
- 图片默认保留远程链接，不下载到本地
- 成功时 stdout 输出生成的 Markdown 文件路径（单行）；失败时 stderr 输出错误信息并以非 0 退出码退出

## 调用

```bash
node skills/dylan-wechat-to-md/scripts/wechat_to_md.mjs "https://mp.weixin.qq.com/s/..."
```

```bash
node skills/dylan-wechat-to-md/scripts/wechat_to_md.mjs "https://mp.weixin.qq.com/s/..." --out "/abs/path/to/dir" --cookie "key=value; ..."
```

## 当前限制

- 本期不实现登录态/付费文章的完整支持
