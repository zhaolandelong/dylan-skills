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
