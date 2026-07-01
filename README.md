# dylan-skills

个人技能仓库，存放自用 Claude Code skills。

- Skill 目录位于 `skills/`
- 命名统一前缀 `dylan-`
- 当前主要目标：把内容平台文章 / 字幕 / 文档沉淀为本地 Markdown

## 开发

```bash
npm i
npm test
```

## 仓库约定

- 根目录 `package.json` 统一提供运行依赖和测试入口
- 各 skill 的可调参数示例见对应目录下的 `config.example.json`
- 脚本默认直接通过 `node skills/<skill>/scripts/*.mjs ...` 调用
- 输出目录参数统一兼容相对路径、绝对路径和 `~/...`

## 已包含 Skill

### dylan-wechat-to-md

把微信公众号文章保存为本地 Markdown，默认保留远程图片链接。

适用场景：

- 给定 `https://mp.weixin.qq.com/s/...` 文章链接
- 希望落一个本地 `.md`
- 需要稳定的 stdout JSON 结果，方便后续串联脚本

常用命令：

```bash
node skills/dylan-wechat-to-md/scripts/wechat_to_md.mjs "https://mp.weixin.qq.com/s/..." --out "/abs/path/to/dir"
```

补充说明：

- 可通过 `--title-conflict skip|overwrite|rename` 控制同名文件处理策略
- 若需要把图片下载到本地并替换引用，继续调用 `dylan-download-md-img`

### dylan-download-md-img

把本地 Markdown 中的远程图片下载到本地目录，并把图片链接改写为相对路径。

适用场景：

- 已经有一个本地 `.md`
- 希望把其中远程图片落地
- 需要兼容受保护的飞书图片

常用命令：

```bash
node skills/dylan-download-md-img/scripts/download_md_img.mjs "/abs/path/to/article.md"
```

补充说明：

- 支持 `--cookie`、`--concurrency`、`--on-conflict`
- Cookie 优先级：Markdown 头部注释 > CLI 参数 > `config.json`
- 图片默认下载到与 Markdown 同级的 `article_id/` 目录

### dylan-yitang-to-md

把一堂文档或一堂飞书文档导出为本地 Markdown；图片默认不下载，但可把后续下载所需 Cookie 写进 Markdown，供 `dylan-download-md-img` 复用。

适用场景：

- 扫码登录一堂并保存可复用登录态
- 导出 `https://yitang.top/fs-doc/...` 文档
- 导出 `https://yitanger.feishu.cn/docx/...` 文档

系统依赖：

- 需要本机安装 Chromium/Chrome（`playwright-core` 使用）
- 导出一堂飞书文档时，建议本机可用 `lark-cli`

常用命令：

```bash
node skills/dylan-yitang-to-md/scripts/yitang_login.mjs
```

```bash
node skills/dylan-yitang-to-md/scripts/yitang_to_md.mjs "https://yitang.top/fs-doc/..." --out "/abs/path/to/dir"
```

```bash
node skills/dylan-yitang-to-md/scripts/yitang_to_md.mjs "https://yitanger.feishu.cn/docx/..." --out "/abs/path/to/dir"
```

```bash
node skills/dylan-yitang-to-md/scripts/yitang_to_md.mjs "https://yitang.top/fs-doc/..." --out "/abs/path/to/dir" --cookie "key=value; ..."
```

补充说明：

- 优先尝试 Cookie；不可用或失效时会提示扫码登录
- 登录态会保存到 `skills/dylan-yitang-to-md/storageState.json`
- 默认会把图片下载所需 Cookie 以注释形式写入 Markdown
- 如需真正落地图片，再执行 `dylan-download-md-img`

### dylan-bili-to-md

处理 B 站视频 / 合集 / 本地媒体文件，优先消费现成字幕，失败时可回退音频转写。

适用场景：

- 下载 B 站视频字幕为 Markdown
- 批量处理合集链接
- 先下载音频再手动转写
- 把本地音频 / 视频文件转成文字 Markdown

常用命令：

```bash
node skills/dylan-bili-to-md/scripts/bili_to_txt.mjs "https://www.bilibili.com/video/BV..."
```

```bash
node skills/dylan-bili-to-md/scripts/bili_to_txt.mjs "https://space.bilibili.com/504934876/lists/7638935"
```

```bash
node skills/dylan-bili-to-md/scripts/bili_download_audio.mjs "https://www.bilibili.com/video/BV..."
```

```bash
node skills/dylan-bili-to-md/scripts/audio_to_md.mjs "/path/to/audio.m4a"
```

补充说明：

- 无字幕时可通过 `--base-url`、`--api-key`、`--model` 接入 OpenAI 兼容 ASR
- 可通过 `--prefer-asr` 强制走音频下载 + ASR 链路
- 音频下载与 `.m4s` 转换依赖系统已安装 `ffmpeg`
