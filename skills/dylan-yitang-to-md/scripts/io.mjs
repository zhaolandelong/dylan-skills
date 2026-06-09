import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import { getCandidateFilenames } from './core.mjs';

const gunzip = promisify(zlib.gunzip);
const inflate = promisify(zlib.inflate);
const defaultHeaders = {
  accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
  'accept-encoding': 'gzip,deflate',
  'accept-language': 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7',
  'cache-control': 'max-age=0',
  priority: 'u=0, i',
  'upgrade-insecure-requests': '1',
  'sec-fetch-dest': 'document',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-site': 'none',
  'sec-fetch-user': '?1',
  'sec-ch-ua':
    '"Chromium";v="148", "Google Chrome";v="148", "Not/A)Brand";v="99"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36'
};

export async function readJsonFile(filePath) {
  try {
    const s = await fs.readFile(filePath, 'utf8');
    return JSON.parse(s);
  } catch (e) {
    if (e && typeof e === 'object' && e.code === 'ENOENT') return null;
    throw e;
  }
}

export async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (e) {
    if (e && typeof e === 'object' && e.code === 'ENOENT') return false;
    return false;
  }
}

export async function writeMarkdownFile({ outDir, title, markdown, onConflict = 'skip' }) {
  await ensureDir(outDir);
  const target = await resolveMarkdownOutputTarget({ outDir, title, onConflict });

  if (target.status === 'skipped') return target;

  await fs.writeFile(target.path, markdown, 'utf8');
  return target;
}

export async function resolveMarkdownOutputTarget({ outDir, title, onConflict = 'skip' }) {
  await ensureDir(outDir);
  const candidates = getCandidateFilenames(title);
  const primaryPath = path.join(outDir, candidates[0]);
  const primaryExists = await fileExists(primaryPath);

  if (onConflict === 'overwrite') {
    return {
      path: primaryPath,
      status: primaryExists ? 'overwritten' : 'created'
    };
  }

  if (onConflict === 'skip') {
    if (primaryExists) {
      return {
        path: primaryPath,
        status: 'skipped'
      };
    }

    return {
      path: primaryPath,
      status: 'created'
    };
  }

  for (const baseName of candidates) {
    const fullPath = path.join(outDir, baseName);
    if (!(await fileExists(fullPath))) {
      return {
        path: fullPath,
        status: fullPath === primaryPath ? 'created' : 'renamed'
      };
    }
  }

  return {
    path: path.join(outDir, `yitang-doc-${Date.now()}.md`),
    status: 'renamed'
  };
}

export async function fetchBuffer(url, { headers = {}, maxRedirects = 5 } = {}) {
  const u = new URL(url);
  const client = u.protocol === 'https:' ? https : http;

  return await new Promise((resolve, reject) => {
    const req = client.request(
      u,
      {
        method: 'GET',
        headers: {
          ...defaultHeaders,
          ...headers
        }
      },
      async (res) => {
        try {
          const status = res.statusCode || 0;
          const location = res.headers.location;

          if (location && status >= 300 && status < 400 && maxRedirects > 0) {
            res.resume();
            const next = new URL(location, u).toString();
            resolve(await fetchBuffer(next, { headers, maxRedirects: maxRedirects - 1 }));
            return;
          }

          if (status < 200 || status >= 300) {
            const buf = await readAll(res);
            const snippet = buf.toString('utf8').slice(0, 200);
            reject(new Error(`请求失败: ${status} ${snippet}`));
            return;
          }

          const buf = await readAll(res);
          const encoding = String(res.headers['content-encoding'] || '').toLowerCase();
          const decoded = await decodeBody(buf, encoding);
          const contentType = String(res.headers['content-type'] || '');
          resolve({ buffer: decoded, contentType });
        } catch (err) {
          reject(err);
        }
      }
    );

    req.on('error', reject);
    req.end();
  });
}

export function pickConfigChromePath(configChromePath, platform = process.platform) {
  if (typeof configChromePath === 'string') {
    const s = configChromePath.trim();
    return s || '';
  }

  if (!configChromePath || typeof configChromePath !== 'object') return '';

  const aliasMap = {
    linux: ['linux'],
    darwin: ['mac', 'darwin', 'macos', 'osx'],
    win32: ['windows', 'win32', 'win']
  };
  const keys = aliasMap[platform] || [platform];
  for (const key of keys) {
    const value = configChromePath[key];
    if (typeof value !== 'string') continue;
    const s = value.trim();
    if (s) return s;
  }

  return '';
}

export async function pickChromiumExecutablePath({ configChromePath } = {}) {
  const configuredPath = pickConfigChromePath(configChromePath);
  if (configuredPath) {
    if (await fileExists(configuredPath)) return configuredPath;
    throw new Error(`config.chromePath 指定的 Chrome 路径不存在: ${configuredPath}`);
  }

  const envPath =
    process.env.YT_CHROME_PATH ||
    process.env.CHROME_PATH ||
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
    '';
  if (envPath && (await fileExists(envPath))) return envPath;

  const candidatesByPlatform = {
    linux: [
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/snap/bin/chromium'
    ],
    darwin: [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium'
    ],
    win32: [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files\\Chromium\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Chromium\\Application\\chrome.exe'
    ]
  };
  const candidates = candidatesByPlatform[process.platform] || candidatesByPlatform.linux;

  for (const p of candidates) {
    if (await fileExists(p)) return p;
  }

  throw new Error(
    '未找到 Chromium/Chrome 可执行文件。请安装 chromium/chrome，或在 config.json 中设置 chromePath，或设置环境变量 YT_CHROME_PATH 指向可执行文件路径。'
  );
}

export function parseCookieString(cookie, baseUrlOrUrls) {
  const s = String(cookie || '').trim();
  if (!s) return [];

  const urls = Array.isArray(baseUrlOrUrls) ? baseUrlOrUrls : [baseUrlOrUrls];
  const cookieUrls = [];
  for (const x of urls) {
    try {
      const u = new URL(x);
      cookieUrls.push(`${u.origin}/`);
    } catch {}
  }
  if (!cookieUrls.length) return [];

  const list = [];
  for (const part of s.split(';')) {
    const seg = part.trim();
    if (!seg) continue;
    const i = seg.indexOf('=');
    if (i <= 0) continue;
    const name = seg.slice(0, i).trim();
    const value = seg.slice(i + 1).trim();
    if (!name) continue;
    for (const cookieUrl of cookieUrls) {
      list.push({ name, value, url: cookieUrl });
    }
  }
  return list;
}

export function buildCookieHeader(cookies) {
  const parts = [];
  for (const c of cookies || []) {
    const name = String(c?.name || '').trim();
    const value = String(c?.value || '');
    if (!name) continue;
    parts.push(`${name}=${value}`);
  }
  return parts.join('; ');
}

async function readAll(stream) {
  const chunks = [];
  for await (const c of stream) chunks.push(c);
  return Buffer.concat(chunks);
}

async function decodeBody(buf, encoding) {
  if (encoding.includes('gzip')) return await gunzip(buf);
  if (encoding.includes('deflate')) return await inflate(buf);
  return buf;
}
