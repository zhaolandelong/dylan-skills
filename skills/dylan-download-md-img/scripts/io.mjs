import fs from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import zlib from 'node:zlib';
import { promisify } from 'node:util';

const gunzip = promisify(zlib.gunzip);
const inflate = promisify(zlib.inflate);

const defaultHeaders = {
  accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
  'accept-encoding': 'gzip,deflate',
  'accept-language': 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7',
  'cache-control': 'no-cache',
  pragma: 'no-cache',
  priority: 'u=0, i',
  'upgrade-insecure-requests': '1',
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36'
};

export async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function fetchBuffer(
  url,
  {
    headers = {},
    maxRedirects = 5,
    timeoutMs = 30_000,
    maxBytes = 25 * 1024 * 1024
  } = {}
) {
  const u = new URL(url);
  const client = u.protocol === 'https:' ? https : http;

  return await new Promise((resolve, reject) => {
    let timer = null;
    let settled = false;
    const done = (err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(value);
    };

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

          if (
            location &&
            status >= 300 &&
            status < 400 &&
            maxRedirects > 0
          ) {
            res.resume();
            const next = new URL(location, u).toString();
            done(
              null,
              await fetchBuffer(next, {
                headers,
                maxRedirects: maxRedirects - 1,
                timeoutMs,
                maxBytes
              })
            );
            return;
          }

          if (status < 200 || status >= 300) {
            const buf = await readAll(res, Math.min(maxBytes, 8192));
            const contentType = String(res.headers['content-type'] || '');
            const snippet = pickErrorSnippet(buf, contentType);
            done(new Error(`请求失败: ${status}${snippet ? ` ${snippet}` : ''}`));
            return;
          }

          const chunks = [];
          let total = 0;
          res.on('data', (c) => {
            total += c.length || 0;
            if (total > maxBytes) {
              res.destroy(new Error(`响应过大: ${total} bytes`));
            }
          });
          res.setTimeout(timeoutMs, () => {
            res.destroy(new Error(`响应超时: ${timeoutMs}ms`));
          });

          for await (const c of res) chunks.push(c);
          const buf = Buffer.concat(chunks);
          const encoding = String(res.headers['content-encoding'] || '').toLowerCase();
          const decoded = await decodeBody(buf, encoding);
          const contentType = String(res.headers['content-type'] || '');
          done(null, { buffer: decoded, contentType });
        } catch (err) {
          done(err);
        }
      }
    );

    req.on('error', done);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`请求超时: ${timeoutMs}ms`));
    });
    req.end();

    timer = setTimeout(() => {
      req.destroy(new Error(`请求超时: ${timeoutMs}ms`));
    }, timeoutMs);
  });
}

async function decodeBody(buf, encoding) {
  if (encoding.includes('gzip')) return await gunzip(buf);
  if (encoding.includes('deflate')) return await inflate(buf);
  return buf;
}

async function readAll(stream, maxBytes = Infinity) {
  const chunks = [];
  let total = 0;
  for await (const c of stream) {
    total += c.length || 0;
    if (total > maxBytes) {
      chunks.push(c.subarray(0, Math.max(0, maxBytes - (total - c.length))));
      break;
    }
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

function pickErrorSnippet(buf, contentType) {
  const ct = String(contentType || '').toLowerCase();
  if (!ct.includes('text') && !ct.includes('json') && !ct.includes('html')) return '';
  return Buffer.from(buf || [])
    .toString('utf8')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}
