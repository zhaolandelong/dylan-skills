import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import http from 'node:http';
import { buildMarkdownId, downloadImagesAndRewriteMarkdown } from '../skills/dylan-download-md-img/scripts/core.mjs';

test('downloadImagesAndRewriteMarkdown adds article_id when missing and rewrites remote image links', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'md-img-'));
  const server = http.createServer((req, res) => {
    if (req.url === '/a.png') {
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      return;
    }
    if (req.url === '/b.jpg') {
      res.writeHead(200, { 'content-type': 'image/jpeg' });
      res.end(Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  try {
    const mdPath = path.join(dir, 'article.md');
    const md = [
      '# Title',
      '',
      `![]( ${base}/a.png )`,
      `![](${base}/a.png)`,
      `![](${base}/b.jpg "t")`,
      '![](./local.png)',
      ''
    ].join('\n');
    await fs.writeFile(mdPath, md, 'utf8');

    const expectedId = buildMarkdownId(path.resolve(mdPath));
    const result = await downloadImagesAndRewriteMarkdown({
      markdownPath: mdPath,
      cookie: '',
      log: () => {}
    });

    assert.equal(result.articleId, expectedId);
    assert.equal(result.total, 2);
    assert.equal(result.downloaded, 2);
    assert.equal(result.rewritten, true);

    const next = await fs.readFile(mdPath, 'utf8');
    assert.match(next, new RegExp(`article_id: "${expectedId}"`));
    assert.match(next, new RegExp(`\\(${expectedId}/img-001\\.png\\)`));
    assert.match(next, new RegExp(`\\(${expectedId}/img-002\\.jpg`));
    assert.match(next, /\(\.\/local\.png\)/);

    const img1 = path.join(dir, expectedId, 'img-001.png');
    const img2 = path.join(dir, expectedId, 'img-002.jpg');
    await fs.access(img1);
    await fs.access(img2);
  } finally {
    server.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('downloadImagesAndRewriteMarkdown keeps existing article_id', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'md-img-'));
  const server = http.createServer((req, res) => {
    if (req.url === '/a.png') {
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  try {
    const mdPath = path.join(dir, 'article.md');
    const md = [
      '---',
      'article_id: "md-fixed"',
      '---',
      '',
      `![](${base}/a.png)`,
      ''
    ].join('\n');
    await fs.writeFile(mdPath, md, 'utf8');

    const result = await downloadImagesAndRewriteMarkdown({
      markdownPath: mdPath,
      cookie: '',
      log: () => {}
    });

    assert.equal(result.articleId, 'md-fixed');
    const next = await fs.readFile(mdPath, 'utf8');
    assert.match(next, /\(md-fixed\/img-001\.png\)/);
  } finally {
    server.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
