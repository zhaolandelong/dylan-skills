import fs from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import zlib from 'node:zlib';
import { promisify } from 'node:util';

const gunzip = promisify(zlib.gunzip);
const inflate = promisify(zlib.inflate);
const defaultHeaders = {
  accept: 'application/json,text/plain,*/*',
  'accept-encoding': 'gzip,deflate',
  'accept-language': 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7',
  'cache-control': 'no-cache',
  pragma: 'no-cache',
  referer: 'https://www.bilibili.com/',
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

export async function resolveFinalUrl(url, { headers = {}, maxRedirects = 5 } = {}) {
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
            resolve(await resolveFinalUrl(next, { headers, maxRedirects: maxRedirects - 1 }));
            return;
          }

          res.resume();
          resolve(u.toString());
        } catch (err) {
          reject(err);
        }
      }
    );

    req.on('error', reject);
    req.end();
  });
}

export async function fetchJson(url, { headers = {}, maxRedirects = 5 } = {}) {
  const { buffer } = await fetchBuffer(url, { headers, maxRedirects });
  const s = buffer.toString('utf8');
  try {
    return JSON.parse(s);
  } catch (e) {
    const snippet = s.slice(0, 200);
    throw new Error(`JSON 解析失败: ${snippet}`);
  }
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
          resolve({ buffer: decoded });
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

export async function writeTextFile({ outDir, filename, text }) {
  await ensureDir(outDir);
  const outputPath = path.join(outDir, filename);
  await fs.writeFile(outputPath, text, 'utf8');
  return outputPath;
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
