import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import { getCandidateFilenames } from './core.mjs';

const gunzip = promisify(zlib.gunzip);
const inflate = promisify(zlib.inflate);

export async function readJsonFile(filePath) {
  try {
    const s = await fs.readFile(filePath, 'utf8');
    return JSON.parse(s);
  } catch (e) {
    if (e && typeof e === 'object' && e.code === 'ENOENT') return null;
    throw e;
  }
}

export async function fetchHtml(url, { headers = {}, maxRedirects = 5 } = {}) {
  const u = new URL(url);
  const client = u.protocol === 'https:' ? https : http;

  return await new Promise((resolve, reject) => {
    const req = client.request(
      u,
      {
        method: 'GET',
        headers: {
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
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
          ...headers
        }
      },
      async (res) => {
        try {
          const status = res.statusCode || 0;
          const location = res.headers.location;

          if (
            location &&
            status >= 300 &&
            status < 400 &&
            maxRedirects > 0
          ) {
            res.resume();
            const next = new URL(location, u).toString();
            resolve(await fetchHtml(next, { headers, maxRedirects: maxRedirects - 1 }));
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
          resolve(decoded.toString('utf8'));
        } catch (err) {
          reject(err);
        }
      }
    );

    req.on('error', reject);
    req.end();
  });
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

export async function writeMarkdownFile({ outDir, title, markdown }) {
  await ensureDir(outDir);
  const candidates = getCandidateFilenames(title);

  for (const baseName of candidates) {
    const fullPath = path.join(outDir, baseName);
    if (!(await fileExists(fullPath))) {
      await fs.writeFile(fullPath, markdown, 'utf8');
      return fullPath;
    }
  }

  const fallback = path.join(outDir, `wechat-article-${Date.now()}.md`);
  await fs.writeFile(fallback, markdown, 'utf8');
  return fallback;
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
