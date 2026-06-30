#!/usr/bin/env node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { transcribeAudioWithOpenAICompatible } from './asr.mjs';
import { buildAudioOutputFilename, buildMarkdownDoc, filenameBaseFromTitle, pickOutDir } from './core.mjs';
import { readJsonFile, writeTextFile } from './io.mjs';
import { isSupportedMediaFile, prepareMediaInput } from './media.mjs';

export function resolveAudioTitle({ cliTitle, inputPath }) {
  const raw = String(cliTitle || '').trim();
  if (raw) return raw;
  return path.basename(String(inputPath || ''), path.extname(String(inputPath || ''))) || 'bilibili-audio';
}

export function resolveAsrOptions({ cliValues, configAsr }) {
  const timeoutValue = Number(cliValues.timeout || configAsr?.timeoutMs || 300_000);
  return {
    baseUrl: String(cliValues['base-url'] || configAsr?.baseUrl || '').trim(),
    apiKey: String(cliValues['api-key'] || configAsr?.apiKey || '').trim(),
    model: String(cliValues.model || configAsr?.model || 'whisper-1').trim(),
    language: String(cliValues.lang || configAsr?.language || 'zh').trim(),
    prompt: String(cliValues.prompt || configAsr?.prompt || '').trim(),
    timeoutMs: Number.isFinite(timeoutValue) && timeoutValue > 0 ? Math.floor(timeoutValue) : 300_000,
  };
}

export async function main(argv = process.argv.slice(2)) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      out: { type: 'string' },
      title: { type: 'string' },
      model: { type: 'string' },
      'base-url': { type: 'string' },
      'api-key': { type: 'string' },
      lang: { type: 'string' },
      prompt: { type: 'string' },
      timeout: { type: 'string' },
    },
  });

  const inputArg = positionals[0];
  if (!inputArg) {
    throw new Error('缺少本地媒体文件路径');
  }

  const inputPath = path.resolve(process.cwd(), inputArg);
  const stat = await fs.stat(inputPath).catch(() => null);
  if (!stat?.isFile()) {
    throw new Error(`输入文件不存在: ${inputPath}`);
  }
  if (!isSupportedMediaFile(inputPath)) {
    throw new Error('文件格式不支持；当前支持 .m4s .m4a .mp3 .wav .mp4 .webm');
  }

  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const skillRoot = path.resolve(scriptDir, '..');
  const configPath = path.join(skillRoot, 'config.json');
  const config = await readJsonFile(configPath);

  const outDir = pickOutDir({
    cliOutDir: values.out,
    configOutDir: config?.outDir,
    cwd: process.cwd(),
    homeDir: os.homedir(),
  });
  if (!outDir) {
    throw new Error('缺少输出目录：请传 --out 或在 config.json 中设置 outDir');
  }

  const asrOptions = resolveAsrOptions({ cliValues: values, configAsr: config?.asr });
  if (!asrOptions.baseUrl) {
    throw new Error('缺少 ASR 服务地址：请传 --base-url 或在 config.json.asr.baseUrl 中设置');
  }

  const title = resolveAudioTitle({ cliTitle: values.title, inputPath });
  const transcribedAt = new Date().toISOString();

  let prepared;
  try {
    prepared = await prepareMediaInput({ inputPath });
    const result = await transcribeAudioWithOpenAICompatible({
      filePath: prepared.filePath,
      baseUrl: asrOptions.baseUrl,
      apiKey: asrOptions.apiKey,
      model: asrOptions.model,
      language: asrOptions.language,
      prompt: asrOptions.prompt,
      timeoutMs: asrOptions.timeoutMs,
    });

    const markdown = buildMarkdownDoc({
      title,
      contentMarkdown: result.text,
      extraFields: {
        source_file: inputPath,
        source_type: 'audio',
        transcribed_at: transcribedAt,
        asr_backend: result.backend,
        asr_model: result.model,
      },
    });

    const filename = buildAudioOutputFilename({ title: filenameBaseFromTitle(title) });
    const outputPath = await writeTextFile({ outDir, filename, text: markdown });
    process.stdout.write(
      `${JSON.stringify({
        path: outputPath,
        input: inputPath,
        mode: 'asr',
        backend: result.backend,
        model: result.model,
      })}\n`
    );
  } finally {
    await prepared?.cleanup?.();
  }
}

function isMainModule() {
  const entry = process.argv[1];
  if (!entry) return false;
  return pathToFileURL(path.resolve(entry)).href === import.meta.url;
}

if (isMainModule()) {
  await main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
