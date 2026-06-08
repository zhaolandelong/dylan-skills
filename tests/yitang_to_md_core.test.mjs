import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  buildArticleId,
  buildFrontmatter,
  filenameBaseFromTitle,
  getCandidateFilenames,
  isProbablyYitangDocUrl,
  pickOutDir,
  resolveOutDirPath
} from '../skills/dylan-yitang-to-md/scripts/core.mjs';

test('isProbablyYitangDocUrl matches yitang fs-doc urls', () => {
  assert.equal(
    isProbablyYitangDocUrl(
      'https://yitang.top/fs-doc/8411b4fbabf562b1b85bc2d68952858e/NRiBdM0dyoU5MmxGLpYcabI0nVh?_uds=hyyy_qgg_live'
    ),
    true
  );
  assert.equal(isProbablyYitangDocUrl('https://yitang.top/'), false);
  assert.equal(isProbablyYitangDocUrl('https://example.com/fs-doc/1'), false);
});

test('buildArticleId is stable and prefixed', () => {
  const a = buildArticleId('https://yitang.top/fs-doc/a/b');
  const b = buildArticleId('https://yitang.top/fs-doc/a/b');
  const c = buildArticleId('https://yitang.top/fs-doc/a/c');
  assert.match(a, /^yt-[0-9a-f]{12}$/);
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test('filenameBaseFromTitle strips invalid characters cross-platform', () => {
  assert.equal(filenameBaseFromTitle('a/b:c*?"<>|d'), 'a b c d');
  assert.equal(filenameBaseFromTitle('   '), 'yitang-doc');
});

test('getCandidateFilenames keeps title as base', () => {
  const list = getCandidateFilenames('Hello World');
  assert.deepEqual(list.slice(0, 3), ['Hello World.md', 'Hello World-2.md', 'Hello World-3.md']);
});

test('resolveOutDirPath resolves relative/empty paths cross-platform', () => {
  const cwd = process.platform === 'win32' ? 'C:\\work\\repo' : '/work/repo';
  const homeDir = process.platform === 'win32' ? 'C:\\Users\\dylan' : '/home/dylan';

  assert.equal(resolveOutDirPath('', cwd, homeDir), '');
  assert.equal(resolveOutDirPath('./x', cwd, homeDir), path.resolve(cwd, './x'));
  assert.equal(resolveOutDirPath('~/x', cwd, homeDir), path.resolve(path.join(homeDir, 'x')));
});

test('pickOutDir throws when missing', () => {
  const cwd = process.platform === 'win32' ? 'C:\\work\\repo' : '/work/repo';
  const homeDir = process.platform === 'win32' ? 'C:\\Users\\dylan' : '/home/dylan';

  assert.throws(() => pickOutDir({ cliOutDir: '', configOutDir: '', cwd, homeDir }), /outDir/);
});

test('buildFrontmatter includes expected keys', () => {
  const fm = buildFrontmatter({
    title: 'T',
    sourceUrl: 'https://yitang.top/fs-doc/a/b',
    fetchedAt: '2026-01-01T00:00:00.000Z'
  });
  assert.match(fm, /article_id:/);
  assert.match(fm, /title:/);
  assert.match(fm, /source_url:/);
  assert.match(fm, /fetched_at:/);
});

