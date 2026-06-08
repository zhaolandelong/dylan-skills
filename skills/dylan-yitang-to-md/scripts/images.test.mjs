import test from 'node:test';
import assert from 'node:assert/strict';
import { extractMarkdownImageUrls } from './images.mjs';

test('extractMarkdownImageUrls extracts unique http(s) image urls', () => {
  const md = [
    '![a](https://a.com/1.png)',
    '![b](https://a.com/1.png)',
    '![c](http://b.com/x.jpg \"t\")',
    '![d](./local.png)',
    'nope'
  ].join('\n');
  assert.deepEqual(extractMarkdownImageUrls(md), ['https://a.com/1.png', 'http://b.com/x.jpg']);
});

