---
name: dylan-wechat-to-md
description: 将微信公众号文章链接转换为 Markdown，并写入到用户指定的本地目录（默认保留远程图片链接）。
---

# dylan-wechat-to-md

## 输入

- 公众号文章 URL（通常是 `https://mp.weixin.qq.com/s/...`）

## 输出

- 在你指定的目录写入一个 `.md` 文件（文件名基于标题 slugify 后生成）

## 使用方式

优先用 CLI `--out` 指定输出目录：

```bash
node skills/dylan-wechat-to-md/scripts/wechat_to_md.mjs "https://mp.weixin.qq.com/s/..." --out "/abs/path/to/dir"
```

如果不传 `--out`，会读取 `skills/dylan-wechat-to-md/config.json` 的 `outDir`；再没有则默认输出到 `./wechat-md/`。

如果出现 “环境异常/verify” 等风控页面，可手动从浏览器复制 Cookie 传入：

```bash
node skills/dylan-wechat-to-md/scripts/wechat_to_md.mjs "https://mp.weixin.qq.com/s/..." --cookie "key=value; ..."
```

## 当前限制

- 本期不实现登录态/付费文章的完整支持
- 图片默认保留远程链接，不下载到本地
