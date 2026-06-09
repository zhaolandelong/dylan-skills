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

          if (
            location &&
            status >= 300 &&
            status < 400 &&
            maxRedirects > 0
          ) {
            res.resume();
            const next = new URL(location, u).toString();
            resolve(
              await fetchBuffer(next, { headers, maxRedirects: maxRedirects - 1 })
            );
            return;
          }

          if (status < 200 || status >= 300) {
            reject(new Error(`请求失败: ${status}`));
            return;
          }

          const chunks = [];
          for await (const c of res) chunks.push(c);
          const buf = Buffer.concat(chunks);
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

async function decodeBody(buf, encoding) {
  if (encoding.includes('gzip')) return await gunzip(buf);
  if (encoding.includes('deflate')) return await inflate(buf);
  return buf;
}
