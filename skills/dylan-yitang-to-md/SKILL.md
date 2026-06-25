---
name: dylan-yitang-to-md
description: 当用户需要登录一堂(yitang.top)或把一堂文档（`https://yitang.top/fs-doc/...`）或一堂飞书文档（`https://yitanger.feishu.cn/docx/...`）导出为本地 Markdown 时使用。包含：扫码登录更新 storageState、导出文章（不下载图片；如需本地化图片请调用 dylan-download-md-img）。对一堂飞书文档会走混合模式：`lark-cli` 抓正文，浏览器打开页面提取图片下载所需 cookie，并写入 Markdown 头部注释供后续图片下载复用。
---

# dylan-yitang-to-md

## 何时使用

- 用户需要扫码登录一堂，拿到可复用的登录态（`storageState.json`）
- 用户说“收藏/下载/保存”并提供一堂文档链接（`https://yitang.top/fs-doc/...`）或一堂的飞书文档链接（`https://yitanger.feishu.cn/docx/...`），希望导出为本地 Markdown

## 系统依赖

- 需要本机安装 Chromium/Chrome（用于 `playwright-core` 启动浏览器）。常见可执行文件路径：`/usr/bin/chromium`、`/usr/bin/google-chrome` 等
- 浏览器路径解析优先级：`config.json` 的 `chromePath` > 环境变量 `YT_CHROME_PATH` / `CHROME_PATH` / `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` > 系统默认安装路径

## 依赖约定

- 本 skill 的 npm 依赖声明在 `package.json` 的 `peerDependencies` 中，目的是复用宿主环境依赖，避免在 skill 自己目录重复安装
- Agent 执行前应先假设宿主项目/全局环境已经安装这些依赖；不要默认进入 `skills/dylan-yitang-to-md` 再执行 `npm install` / `pnpm install` / `yarn install`
- 若运行时报缺少模块，再提示用户在宿主环境补装 `cheerio`、`jsqr`、`playwright-core`、`pngjs`、`qrcode-terminal`、`turndown`，然后重试

## 入参

本 skill 拆成 2 个入口：

### 1) 登录一堂（扫码）

- 脚本：`node skills/dylan-yitang-to-md/scripts/yitang_login.mjs`
- `--qr-screenshot-wait-seconds <n>`（可选）：二维码就绪后，截图前额外等待 `n` 秒，默认 `10`
- 行为：打开 `https://sso.yitang.top/account/login/`，等待二维码就绪后，先按 `qrScreenshotWaitSeconds`/`--qr-screenshot-wait-seconds` 额外等待（默认 10 秒）再截图；截图保存到 `skills/dylan-yitang-to-md/login-qr.png`，同时输出完整绝对路径（stdout）；若二维码在主页面 DOM 中，还会尽量在终端渲染一个可扫码的字符二维码。会提示用户“仅有 2 分钟扫码时间”；扫码后把登录态写入 `skills/dylan-yitang-to-md/storageState.json`

### 2) 收藏/下载文章（导出 Markdown）

- 脚本：`node skills/dylan-yitang-to-md/scripts/yitang_to_md.mjs "<url>"`
- `url`（必填）：支持两类文档 URL：
  - 一堂文档：`https://yitang.top/fs-doc/...`
  - 飞书文档：`https://yitanger.feishu.cn/docx/...`
- `--out <dir>`（可选）：输出目录。支持相对路径/绝对路径/`~/...`；相对路径以当前工作目录为基准。若未传且 config 未配置会报错
- `--cookie "<cookie>"`（可选）：从浏览器复制的 Cookie，用于免扫码登录（优先尝试）
- `--embed-image-cookie` / `--no-embed-image-cookie`（可选）：是否把后续图片下载所需 cookie 以注释形式写进 Markdown，默认开启
- `--on-conflict <mode>`（可选）：重名处理策略，支持 `skip` / `overwrite` / `rename`，默认 `skip`
- `--overwrite` / `--rename`（可选）：`--on-conflict` 的快捷写法
- `--qr-screenshot-wait-seconds <n>`（可选）：进入扫码流程后，二维码就绪到截图之间额外等待 `n` 秒，默认 `10`
- `--headed`（可选）：调试用，非 headless 运行

也可以通过 [config.json](./config.json) 提供默认值：

- `outDir`：输出目录（必填）
- `cookie`：默认 Cookie（可选）
- `embedImageCookie`：是否把图片下载 cookie 写入 Markdown 头部注释，默认 `true`
- `larkCliPath`：`lark-cli` 可执行文件路径。用于飞书文档混合模式；若未配置，会尝试自动从 `~/.nvm/versions/node/*/bin/lark-cli` 查找
- `onConflict`：重名处理策略，支持 `skip` / `overwrite` / `rename`，默认 `skip`
- `qrScreenshotWaitSeconds`：二维码就绪后，截图前额外等待的秒数，默认 `10`
- `chromePath`：Chrome/Chromium 可执行文件路径。支持直接写字符串，也支持按平台分别配置：

```json
{
  "chromePath": {
    "linux": "/usr/bin/google-chrome",
    "mac": "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "windows": "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
  }
}
```

## 登录行为

- 优先使用 Cookie（CLI `--cookie` 或 config `cookie`）尝试直接访问正文
- 若 Cookie 不可用/失效，会自动提示你扫码登录（会输出二维码截图路径到 stderr），登录成功后落盘 `skills/dylan-yitang-to-md/storageState.json` 供下次复用
- 对一堂文档：正文由浏览器抓取
- 对飞书文档：正文由 `lark-cli docs +fetch --api-version v2 --doc-format markdown` 抓取；浏览器仍会打开同一文档 URL，用于提取图片下载所需 cookie

## 输出

- 写入一个 Markdown 文件到输出目录（文件名基于文档标题生成；默认重名直接跳过，可通过参数改为覆盖或重命名）
- Markdown 顶部包含 frontmatter：`article_id` / `title` / `source_url` / `fetched_at`
- 默认会在 frontmatter 后额外写入一行 cookie 注释：`<!-- dylan-download-md-img-cookie: <base64url> -->`，供 `dylan-download-md-img` 自动读取
- 若需要下载并本地化图片，请调用 `dylan-download-md-img`（会在 Markdown 同级创建 `article_id/` 目录并回写链接）
- 成功时 stdout 输出生成的 Markdown 文件路径（单行）；失败时 stderr 输出错误信息并以非 0 退出码退出

## 调用

```bash
node skills/dylan-yitang-to-md/scripts/yitang_login.mjs
```

```bash
node skills/dylan-yitang-to-md/scripts/yitang_to_md.mjs "https://yitang.top/fs-doc/..."
```

```bash
node skills/dylan-yitang-to-md/scripts/yitang_to_md.mjs "https://yitang.top/fs-doc/..." --out "/abs/path/to/dir" --cookie "key=value; ..."
```

```bash
node skills/dylan-yitang-to-md/scripts/yitang_to_md.mjs "https://yitanger.feishu.cn/docx/..." --out "/abs/path/to/dir"
```
