import fs from 'node:fs/promises';
import path from 'node:path';

const CONTENT_TYPES = {
  '.m4a': 'audio/mp4',
  '.m4s': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.wav': 'audio/wav',
  '.webm': 'audio/webm',
};

export async function transcribeAudioWithOpenAICompatible({
  filePath,
  baseUrl,
  apiKey = '',
  model,
  language = '',
  prompt = '',
  timeoutMs = 300_000,
}) {
  const normalizedBaseUrl = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!normalizedBaseUrl) {
    throw new Error('缺少 ASR 服务地址：请通过 --base-url 或 config.json.asr.baseUrl 提供');
  }
  if (!String(model || '').trim()) {
    throw new Error('缺少 ASR 模型：请通过 --model 或 config.json.asr.model 提供');
  }

  const fileBuffer = await fs.readFile(filePath);
  const formData = new FormData();
  const blob = new Blob([fileBuffer], { type: guessContentType(filePath) });
  formData.append('file', blob, path.basename(filePath));
  formData.append('model', String(model).trim());
  if (String(language || '').trim()) formData.append('language', String(language).trim());
  if (String(prompt || '').trim()) formData.append('prompt', String(prompt).trim());

  const headers = {};
  if (String(apiKey || '').trim()) {
    headers.authorization = `Bearer ${String(apiKey).trim()}`;
  }

  const response = await fetch(`${normalizedBaseUrl}/v1/audio/transcriptions`, {
    method: 'POST',
    headers,
    body: formData,
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    const snippet = compactText(await response.text());
    throw new Error(
      `ASR 请求失败: ${response.status}${snippet ? ` ${snippet}` : ''}`
    );
  }

  const responseText = await response.text();
  let data;
  try {
    data = JSON.parse(responseText);
  } catch {
    const snippet = compactText(responseText);
    throw new Error(`ASR 响应不是合法 JSON${snippet ? `: ${snippet}` : ''}`);
  }

  const text = String(data?.text || '').trim();
  if (!text) {
    throw new Error('ASR 响应缺少 text 字段或文本为空');
  }

  return {
    text: `${text}\n`,
    model: String(data?.model || model).trim(),
    backend: 'openai-compatible',
    language: String(data?.language || language || '').trim(),
    raw: data,
  };
}

function guessContentType(filePath) {
  const ext = path.extname(String(filePath || '')).toLowerCase();
  return CONTENT_TYPES[ext] || 'application/octet-stream';
}

function compactText(input) {
  return String(input || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}
