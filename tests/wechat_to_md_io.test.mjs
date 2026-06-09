import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { writeMarkdownFile } from '../skills/dylan-wechat-to-md/scripts/io.mjs';

test('writeMarkdownFile respects titleConflict=skip|overwrite|rename', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wx-md-'));
  try {
    const title = 'Same Title';

    const first = await writeMarkdownFile({
      outDir: dir,
      title,
      markdown: 'v1\n',
      titleConflict: 'skip'
    });
    assert.equal(first.action, 'created');
    const primaryPath = first.path;

    const skipped = await writeMarkdownFile({
      outDir: dir,
      title,
      markdown: 'v2\n',
      titleConflict: 'skip'
    });
    assert.equal(skipped.action, 'skipped');
    assert.equal(skipped.path, primaryPath);
    assert.equal(await fs.readFile(primaryPath, 'utf8'), 'v1\n');

    const overwritten = await writeMarkdownFile({
      outDir: dir,
      title,
      markdown: 'v3\n',
      titleConflict: 'overwrite'
    });
    assert.equal(overwritten.action, 'overwritten');
    assert.equal(overwritten.path, primaryPath);
    assert.equal(await fs.readFile(primaryPath, 'utf8'), 'v3\n');

    const renamed = await writeMarkdownFile({
      outDir: dir,
      title,
      markdown: 'v4\n',
      titleConflict: 'rename'
    });
    assert.equal(renamed.action, 'renamed');
    assert.notEqual(renamed.path, primaryPath);
    assert.equal(await fs.readFile(renamed.path, 'utf8'), 'v4\n');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
