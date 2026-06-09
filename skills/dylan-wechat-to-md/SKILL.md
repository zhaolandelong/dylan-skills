---
name: dylan-wechat-to-md
description: 当用户提到“收藏/下载”并提供微信公众号文章链接时使用。会把文章保存为本地 Markdown，stdout 单行返回包含 `path` 和 `article_id` 的 JSON。
---

# dylan-wechat-to-md

## 何时使用

- 用户提供公众号文章链接（`https://mp.weixin.qq.com/s/...`），希望收藏到本地 Markdown
- 默认保留远程图片链接；若用户希望把图片落地并替换引用，请改用 `dylan-download-md-img`

## 依赖约定

- 本 skill 的 npm 依赖声明在 `package.json` 的 `peerDependencies` 中，目的是复用宿主环境依赖，避免在 skill 自己目录重复安装
- Agent 执行前应先假设宿主项目/全局环境已经安装这些依赖；不要默认进入 `skills/dylan-wechat-to-md` 再执行 `npm install` / `pnpm install` / `yarn install`
- 若运行时报缺少模块，再提示用户在宿主环境补装 `cheerio`、`turndown`，然后重试

## 入参

- `url`（必填）：公众号文章 URL（`https://mp.weixin.qq.com/s/...`）
- `--out <dir>`（可选）：输出目录。支持相对路径/绝对路径/`~/...`；相对路径以当前工作目录为基准
- `--cookie "<cookie>"`（可选）：微信风控时用于携带登录态/验证态 Cookie
- `--title-conflict <skip|overwrite|rename>`（可选）：标题对应的文件名已存在时的处理策略，默认 `skip`

也可以通过 [config.json](./config.json) 提供默认值：

- `outDir`：默认输出目录（当未传 `--out` 时生效）
- `cookie`：默认 Cookie（当未传 `--cookie` 时生效）
- `titleConflict`：标题冲突策略（当未传 `--title-conflict` 时生效）

## 输出

- stdout：单行输出 JSON，格式为 `{"path":"...","article_id":"..."}`，便于脚本和其他 skill 消费
- 写入一个 Markdown 文件到输出目录（文件名基于文章标题生成；标题相同默认跳过，可用 `--title-conflict` 控制行为）
- Markdown 顶部包含 frontmatter：`article_id` / `title` / `source_url` / `fetched_at`

## 调用

```bash
node skills/dylan-wechat-to-md/scripts/wechat_to_md.mjs "https://mp.weixin.qq.com/s/..."
```

## 当前限制

- 本期不实现登录态/付费文章的完整支持
