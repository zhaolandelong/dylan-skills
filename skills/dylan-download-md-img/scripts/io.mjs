import fs from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import zlib from 'node:zlib';
import { promisify } from 'node:util';

const gunzip = promisify(zlib.gunzip);
const inflate = promisify(zlib.inflate);

const defaultHeaders = {
  accept: '*/*',
  'accept-encoding': 'gzip,deflate',
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
            done(new Error(`请求失败: ${status}`));
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
