import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const SUPPORTED_MEDIA_EXTENSIONS = new Set([
  '.m4a',
  '.m4s',
  '.mp3',
  '.mp4',
  '.wav',
  '.webm',
]);

export function isSupportedMediaFile(inputPath) {
  const ext = path.extname(String(inputPath || '')).toLowerCase();
  return SUPPORTED_MEDIA_EXTENSIONS.has(ext);
}

export function needsPreprocess(inputPath) {
  return path.extname(String(inputPath || '')).toLowerCase() === '.m4s';
}

export async function prepareMediaInput({ inputPath, tmpDir = os.tmpdir() }) {
  if (!needsPreprocess(inputPath)) {
    return {
      filePath: inputPath,
      cleanup: async () => {},
    };
  }

  const tempDir = await fs.mkdtemp(path.join(tmpDir, 'dylan-bili-audio-'));
  const baseName = path.basename(inputPath, path.extname(inputPath)) || 'audio';
  const outputPath = path.join(tempDir, `${baseName}.wav`);

  try {
    await convertM4sToWav({ inputPath, outputPath });
  } catch (error) {
    await fs.rm(tempDir, { recursive: true, force: true });
    throw error;
  }

  return {
    filePath: outputPath,
    cleanup: async () => {
      await fs.rm(tempDir, { recursive: true, force: true });
    },
  };
}

export async function convertMediaToM4a({ inputPath, outputPath }) {
  await runFfmpeg([
    '-y',
    '-i',
    inputPath,
    '-vn',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    outputPath,
  ], '转 m4a');
}

export async function concatM4aFiles({ inputPaths, outputPath }) {
  const items = Array.isArray(inputPaths) ? inputPaths.filter(Boolean) : [];
  if (!items.length) {
    throw new Error('缺少需要拼接的音频文件');
  }
  if (items.length === 1) {
    await fs.copyFile(items[0], outputPath);
    return;
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dylan-bili-concat-'));
  const listPath = path.join(tempDir, 'inputs.txt');
  try {
    const listContent = items
      .map((p) => `file ${JSON.stringify(String(p))}`)
      .join('\n');
    await fs.writeFile(listPath, listContent + '\n', 'utf8');
    await runFfmpeg(
      ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', outputPath],
      '拼接音频'
    );
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function convertM4sToWav({ inputPath, outputPath }) {
  await runFfmpeg([
    '-y',
    '-i',
    inputPath,
    '-vn',
    '-ac',
    '1',
    '-ar',
    '16000',
    '-c:a',
    'pcm_s16le',
    outputPath,
  ], '预处理');
}

async function runFfmpeg(args, actionLabel) {
  await new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });

    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk || '');
    });

    child.on('error', (error) => {
      if (error && typeof error === 'object' && error.code === 'ENOENT') {
        reject(new Error(`需要 ffmpeg 才能${actionLabel}媒体文件；请先在系统中安装 ffmpeg`));
        return;
      }
      reject(error);
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      const snippet = String(stderr).replace(/\s+/g, ' ').trim().slice(0, 200);
      reject(new Error(`ffmpeg ${actionLabel}失败${snippet ? `: ${snippet}` : ''}`));
    });
  });
}
