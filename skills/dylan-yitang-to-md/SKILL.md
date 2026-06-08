---
name: dylan-yitang-to-md
description: 当用户需要登录一堂(yitang.top)或把一堂文档(/fs-doc/...)导出为本地 Markdown 时使用。包含：扫码登录更新 storageState、导出文章（默认不下载图片）、按 article_id 批量下载图片并回写链接。
---

# dylan-yitang-to-md

## 何时使用

- 用户需要扫码登录一堂，拿到可复用的登录态（`storageState.json`）
- 用户说“收藏/下载/保存”并提供一堂文档链接（`https://yitang.top/fs-doc/...`），希望导出为本地 Markdown（默认不下载图片）
- 用户已有 Markdown（含 frontmatter 的 `article_id`）并希望把图片批量下载到本地并替换链接（失败的不替换）

## 系统依赖

- 需要本机安装 Chromium/Chrome（用于 `playwright-core` 启动浏览器）。常见可执行文件路径：`/usr/bin/chromium`、`/usr/bin/google-chrome` 等

## 入参

本 skill 拆成 3 个入口：

### 1) 登录一堂（扫码）

- 脚本：`node skills/dylan-yitang-to-md/scripts/yitang_login.mjs`
- 行为：打开 `https://sso.yitang.top/account/login/`，等待二维码就绪后截图；若二维码在主页面 DOM 中则直接截 `img.qrcode.lightBorder.js_qrcode_img`，若二维码在 `#login_container` 包裹的 iframe 中则优先截 iframe 内的 `img.qrcode`，拿不到时再回退到 `#login_container` / iframe 容器截图。截图保存到 `skills/dylan-yitang-to-md/login-qr.png`，同时输出完整绝对路径（stdout）；若二维码在主页面 DOM 中，还会尽量在终端渲染一个可扫码的字符二维码。会提示用户“仅有 2 分钟扫码时间”；扫码后把登录态写入 `skills/dylan-yitang-to-md/storageState.json`

### 2) 收藏/下载文章（导出 Markdown）

- 脚本：`node skills/dylan-yitang-to-md/scripts/yitang_to_md.mjs "<url>"`
- `url`（必填）：一堂文档 URL（`https://yitang.top/fs-doc/...`）
- `--out <dir>`（可选）：输出目录。支持相对路径/绝对路径/`~/...`；相对路径以当前工作目录为基准。若未传且 config 未配置会报错
- `--cookie "<cookie>"`（可选）：从浏览器复制的 Cookie，用于免扫码登录（优先尝试）
- `--download-images` / `--no-download-images`（可选）：是否下载图片，默认 **关闭**
- `--on-conflict <mode>`（可选）：重名处理策略，支持 `skip` / `overwrite` / `rename`，默认 `skip`
- `--overwrite` / `--rename`（可选）：`--on-conflict` 的快捷写法
- `--headed`（可选）：调试用，非 headless 运行

### 3) 下载图片到本地并回写链接

- 脚本：`node skills/dylan-yitang-to-md/scripts/yitang_images.mjs "<article_id>"`
- `article_id`（必填）：Markdown frontmatter 里的 `article_id`（例如 `yt-xxxx`）
- `--out <dir>`（可选）：输出目录（用于定位对应 Markdown；默认取 config 的 outDir）
- 行为：找到对应 Markdown，下载其图片到本地目录，并只替换下载成功的图片链接（下载失败的不替换）

也可以通过 [config.json](file:///home/dylan/projects/dylan-skills/skills/dylan-yitang-to-md/config.json) 提供默认值：

- `outDir`：输出目录（必填）
- `cookie`：默认 Cookie（可选）
- `downloadImages`：是否下载图片（默认 false）
- `onConflict`：重名处理策略，支持 `skip` / `overwrite` / `rename`，默认 `skip`

## 登录行为

- 优先使用 Cookie（CLI `--cookie` 或 config `cookie`）尝试直接访问正文
- 若 Cookie 不可用/失效，会自动提示你扫码登录（会输出二维码截图路径到 stderr），登录成功后落盘 `skills/dylan-yitang-to-md/storageState.json` 供下次复用

## 输出

- 写入一个 Markdown 文件到输出目录（文件名基于文档标题生成；默认重名直接跳过，可通过参数改为覆盖或重命名）
- Markdown 顶部包含 frontmatter：`article_id` / `title` / `source_url` / `fetched_at`
- 图片下载（可选）：会在 Markdown 同级创建 `article_id` 同名目录存放图片，并把 Markdown 图片链接替换为相对路径；下载失败的图片链接保持原样
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
node skills/dylan-yitang-to-md/scripts/yitang_images.mjs "yt-xxxxxxxxxxxx"
```
