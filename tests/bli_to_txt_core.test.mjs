import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  buildAudioOutputFilename,
  buildArticleId,
  buildFrontmatter,
  buildMarkdownDoc,
  buildOutputFilename,
  encodeWbiParams,
  extractWbiKeys,
  filenameBaseFromTitle,
  parseBilibiliVideoUrl,
  pickOutDir,
  pickPreferredSubtitle,
  subtitleBodyToPlainText
} from '../skills/dylan-bili-to-md/scripts/core.mjs';

test('parseBilibiliVideoUrl parses BV and p', () => {
  const r = parseBilibiliVideoUrl(
    'https://www.bilibili.com/video/BV1qh7b6xEAH/?spm_id_from=333.1007&t=1&p=2'
  );
  assert.equal(r.bvid, 'BV1qh7b6xEAH');
  assert.equal(r.p, 2);
});

test('parseBilibiliVideoUrl parses av', () => {
  const r = parseBilibiliVideoUrl('https://www.bilibili.com/video/av12345/?p=1');
  assert.equal(r.aid, 12345);
  assert.equal(r.p, 1);
});

test('pickOutDir resolves relative/tilde and requires value', () => {
  const cwd = process.platform === 'win32' ? 'C:\\work\\repo' : '/work/repo';
  const homeDir = process.platform === 'win32' ? 'C:\\Users\\dylan' : '/home/dylan';

  assert.equal(pickOutDir({ cliOutDir: '', configOutDir: '', cwd, homeDir }), '');
  assert.equal(
    pickOutDir({ cliOutDir: './x', configOutDir: './cfg', cwd, homeDir }),
    path.resolve(cwd, './x')
  );
  assert.equal(
    pickOutDir({ cliOutDir: '', configOutDir: '~/x', cwd, homeDir }),
    path.resolve(path.join(homeDir, 'x'))
  );
});

test('filenameBaseFromTitle strips invalid characters cross-platform', () => {
  assert.equal(filenameBaseFromTitle('a/b:c*?"<>|d'), 'a b c d');
  assert.equal(filenameBaseFromTitle('   '), 'bilibili-subtitle');
});

test('buildOutputFilename adds p and lang', () => {
  assert.equal(
    buildOutputFilename({ title: 'Hello', p: 1, lang: 'zh-CN' }),
    'Hello-zh-CN.md'
  );
  assert.equal(
    buildOutputFilename({ title: 'Hello', p: 3, lang: 'zh-CN' }),
    'Hello-p3-zh-CN.md'
  );
});

test('buildAudioOutputFilename adds asr suffix', () => {
  assert.equal(buildAudioOutputFilename({ title: 'Hello' }), 'Hello-asr.md');
});

test('pickPreferredSubtitle prefers cc then ai, and prefers zh-CN', () => {
  const picked = pickPreferredSubtitle([
    { lan: 'zh-CN', subtitle_type: 1, url: '' },
    { lan: 'en', subtitle_type: 1, url: '//example.com/en.json' },
    { lan: 'zh-CN', type: 2, url: '//example.com/ai-zh.json' },
    { lan: 'zh-CN', type: 1, subtitle_url: '//example.com/cc-zh.json' }
  ]);
  assert.ok(picked);
  assert.equal(picked.lang, 'zh-CN');
  assert.equal(picked.source, 'cc');
  assert.equal(picked.url, 'https://example.com/cc-zh.json');
});

test('subtitleBodyToPlainText joins lines and dedup adjacent', () => {
  const text = subtitleBodyToPlainText([
    { content: '第一句' },
    { content: '第一句' },
    { content: '  第二句  ' },
    { content: '' }
  ]);
  assert.equal(text, '第一句\n第二句\n');
});

test('extractWbiKeys gets img/sub keys from nav data', () => {
  const keys = extractWbiKeys({
    wbi_img: {
      img_url: 'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png',
      sub_url: 'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png'
    }
  });
  assert.deepEqual(keys, {
    imgKey: '7cd084941338484aae1ad9425b84077c',
    subKey: '4932caff0ff746eab6f01bf08b70ac45'
  });
});

test('encodeWbiParams appends wts and w_rid', () => {
  const query = encodeWbiParams(
    { aid: '1', cid: '2', web_location: '1315873', isGaiaAvoided: 'false' },
    {
      imgKey: '7cd084941338484aae1ad9425b84077c',
      subKey: '4932caff0ff746eab6f01bf08b70ac45',
      now: 1700000000
    }
  );
  assert.match(query, /(^|&)wts=1700000000(&|$)/);
  assert.match(query, /(^|&)w_rid=[0-9a-f]{32}($|&)/);
});

test('buildArticleId/buildFrontmatter/buildMarkdownDoc use yml frontmatter style', () => {
  const url = 'https://www.bilibili.com/video/BV1qh7b6xEAH/';
  const articleId = buildArticleId(url);
  assert.match(articleId, /^bili-[0-9a-f]{12}$/);

  const frontmatter = buildFrontmatter({
    title: '标题',
    sourceUrl: url,
    fetchedAt: '2026-06-30T06:46:47.264Z'
  });
  assert.equal(
    frontmatter,
    `---\narticle_id: ${JSON.stringify(articleId)}\ntitle: "标题"\nsource_url: ${JSON.stringify(
      url
    )}\nfetched_at: "2026-06-30T06:46:47.264Z"\n---\n`
  );

  const doc = buildMarkdownDoc({
    title: '标题',
    sourceUrl: url,
    fetchedAt: '2026-06-30T06:46:47.264Z',
    contentMarkdown: '第一行\n第二行'
  });
  assert.match(doc, /^---\narticle_id:/);
  assert.match(doc, /\n---\n第一行\n第二行\n$/);
});

test('buildFrontmatter/buildMarkdownDoc support extra fields for audio transcription', () => {
  const frontmatter = buildFrontmatter({
    title: '音频标题',
    extraFields: {
      source_file: '/tmp/audio.m4s',
      source_type: 'audio',
      asr_model: 'whisper-1'
    }
  });
  assert.match(frontmatter, /source_file: "\/tmp\/audio\.m4s"/);
  assert.match(frontmatter, /source_type: "audio"/);
  assert.match(frontmatter, /asr_model: "whisper-1"/);
  assert.doesNotMatch(frontmatter, /source_url:/);

  const doc = buildMarkdownDoc({
    title: '音频标题',
    contentMarkdown: '第一句',
    extraFields: {
      source_file: '/tmp/audio.m4s',
      source_type: 'audio',
      transcribed_at: '2026-06-30T00:00:00.000Z',
      asr_backend: 'openai-compatible',
      asr_model: 'whisper-1'
    }
  });
  assert.match(doc, /transcribed_at: "2026-06-30T00:00:00\.000Z"/);
  assert.match(doc, /\n---\n第一句\n$/);
});
