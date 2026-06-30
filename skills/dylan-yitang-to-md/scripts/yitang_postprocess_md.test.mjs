import test from 'node:test';
import assert from 'node:assert/strict';
import { transformMarkdown } from './yitang_postprocess_md.mjs';

test('transformMarkdown aligns frontmatter, removes title tag, keeps image alt by default', () => {
  const input = [
    '<title>逐字稿实操：从入门到高手</title>',
    '',
    '# 开始上课',
    '',
    '<grid>',
    '<column width-ratio="0.2">',
    '![一大段图片描述](https://feishu.cn/file/boxcn123)',
    '</column>',
    '</grid>',
    '![第二张图](https://internal-api-drive-stream.feishu.cn/space/api/box/stream/download/v2/cover/boxcn456/?fallback_source=1&height=1280)',
    ''
  ].join('\n');

  const { filename, content } = transformMarkdown(input, {
    inputPath: '/tmp/开始上课.md',
    sourceUrl: 'https://yitanger.feishu.cn/docx/EGl2dAkwMoQXTzxGGAgcZlNhnoe',
    fetchedAt: '2026-06-26T00:00:00.000Z'
  });

  assert.equal(filename, '逐字稿实操：从入门到高手.md');
  assert.match(content, /^---\narticle_id:/);
  assert.match(content, /title: "逐字稿实操：从入门到高手"/);
  assert.match(content, /source_url: "https:\/\/yitanger\.feishu\.cn\/docx\/EGl2dAkwMoQXTzxGGAgcZlNhnoe"/);
  assert.doesNotMatch(content, /<title>/);
  assert.doesNotMatch(content, /<grid>|<\/grid>|<column|<\/column>/);
  assert.match(content, /\n# 开始上课\n/);
  assert.match(
    content,
    /!\[一大段图片描述\]\(https:\/\/internal-api-drive-stream\.feishu\.cn\/space\/api\/box\/stream\/download\/v2\/cover\/boxcn123\/\)/
  );
  assert.match(
    content,
    /!\[第二张图\]\(https:\/\/internal-api-drive-stream\.feishu\.cn\/space\/api\/box\/stream\/download\/v2\/cover\/boxcn456\/\)/
  );
});

test('transformMarkdown rewrites feishu image urls by default', () => {
  const input = [
    '<title>逐字稿实操：从入门到高手</title>',
    '',
    '![x](https://feishu.cn/file/boxcn123)',
    ''
  ].join('\n');

  const { content } = transformMarkdown(input, { inputPath: '/tmp/开始上课.md' });

  assert.match(content, /!\[x\]\(https:\/\/internal-api-drive-stream\.feishu\.cn\/space\/api\/box\/stream\/download\/v2\/cover\/boxcn123\/\)/);
});

test('transformMarkdown clears image alt text only when enabled', () => {
  const input = [
    '<title>逐字稿实操：从入门到高手</title>',
    '',
    '![一大段图片描述](https://feishu.cn/file/boxcn123)',
    ''
  ].join('\n');

  const { content } = transformMarkdown(input, {
    inputPath: '/tmp/开始上课.md',
    stripImageAlt: true
  });

  assert.match(
    content,
    /!\[]\(https:\/\/internal-api-drive-stream\.feishu\.cn\/space\/api\/box\/stream\/download\/v2\/cover\/boxcn123\/\)/
  );
});
