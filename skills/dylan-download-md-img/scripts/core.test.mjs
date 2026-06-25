import test from 'node:test';
import assert from 'node:assert/strict';
import { extractEmbeddedDownloadCookie } from './core.mjs';

test('extractEmbeddedDownloadCookie decodes embedded cookie comment', () => {
  const encoded = Buffer.from('session=abc; passport=xyz').toString('base64url');
  const markdown = [
    '---',
    'article_id: "yt-123"',
    '---',
    '',
    `<!-- dylan-download-md-img-cookie: ${encoded} -->`,
    '',
    '# 标题'
  ].join('\n');

  assert.equal(extractEmbeddedDownloadCookie(markdown), 'session=abc; passport=xyz');
});
