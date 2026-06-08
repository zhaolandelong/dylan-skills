import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolveMarkdownOutputTarget, writeMarkdownFile } from './io.mjs';

test('writeMarkdownFile skips existing file by default', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'yt-io-test-'));
  try {
    const first = await writeMarkdownFile({
      outDir: dir,
      title: '同名文章',
      markdown: 'first'
    });
    const second = await writeMarkdownFile({
      outDir: dir,
      title: '同名文章',
      markdown: 'second'
    });

    assert.equal(first.status, 'created');
    assert.equal(second.status, 'skipped');
    assert.equal(second.path, first.path);
    assert.equal(await fs.readFile(first.path, 'utf8'), 'first');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('resolveMarkdownOutputTarget preflights skip without writing file', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'yt-io-test-'));
  try {
    const first = await writeMarkdownFile({
      outDir: dir,
      title: '同名文章',
      markdown: 'first'
    });
    const target = await resolveMarkdownOutputTarget({
      outDir: dir,
      title: '同名文章',
      onConflict: 'skip'
    });

    assert.equal(target.status, 'skipped');
    assert.equal(target.path, first.path);
    assert.equal(await fs.readFile(first.path, 'utf8'), 'first');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('writeMarkdownFile overwrites existing file when requested', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'yt-io-test-'));
  try {
    const first = await writeMarkdownFile({
      outDir: dir,
      title: '同名文章',
      markdown: 'first'
    });
    const second = await writeMarkdownFile({
      outDir: dir,
      title: '同名文章',
      markdown: 'second',
      onConflict: 'overwrite'
    });

    assert.equal(second.status, 'overwritten');
    assert.equal(second.path, first.path);
    assert.equal(await fs.readFile(first.path, 'utf8'), 'second');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('writeMarkdownFile renames existing file when requested', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'yt-io-test-'));
  try {
    const first = await writeMarkdownFile({
      outDir: dir,
      title: '同名文章',
      markdown: 'first'
    });
    const second = await writeMarkdownFile({
      outDir: dir,
      title: '同名文章',
      markdown: 'second',
      onConflict: 'rename'
    });

    assert.equal(second.status, 'renamed');
    assert.notEqual(second.path, first.path);
    assert.match(path.basename(second.path), /^同名文章-2\.md$/);
    assert.equal(await fs.readFile(first.path, 'utf8'), 'first');
    assert.equal(await fs.readFile(second.path, 'utf8'), 'second');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
