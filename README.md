# dylan-skills

个人技能仓库，存放自用的 Claude Code skills（位于 `skills/`，命名统一前缀 `dylan-`）。

## 开发

```bash
npm i
npm test
```

## 已包含 Skill

### dylan-wechat-to-md

将微信公众号文章链接转换为 Markdown 并写入到本地目录（默认保留远程图片链接）。

```bash
node skills/dylan-wechat-to-md/scripts/wechat_to_md.mjs "https://mp.weixin.qq.com/s/..." --out "/abs/path/to/dir"
```

目录参数兼容 Linux/macOS/Windows：支持相对路径、绝对路径、以及 `~/...`（在 Windows 上会展开为当前用户目录）。

### dylan-yitang-to-md

将一堂（`yitang.top/fs-doc/...`）文档导出为本地 Markdown，并默认下载图片到本地后替换为相对路径。

系统依赖：需要本机安装 Chromium/Chrome（`playwright-core` 使用）。

```bash
node skills/dylan-yitang-to-md/scripts/yitang_to_md.mjs "https://yitang.top/fs-doc/..." --out "/abs/path/to/dir"
```

```bash
node skills/dylan-yitang-to-md/scripts/yitang_to_md.mjs "https://yitang.top/fs-doc/..." --out "/abs/path/to/dir" --cookie "key=value; ..."
```

登录策略：优先尝试 Cookie；若 Cookie 不可用/失效，会提示扫码登录并保存 storageState 供下次复用。
