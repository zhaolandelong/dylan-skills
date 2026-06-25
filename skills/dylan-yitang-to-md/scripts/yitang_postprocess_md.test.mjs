import test from 'node:test';
import assert from 'node:assert/strict';
import { transformMarkdown } from './yitang_postprocess_md.mjs';

test('transformMarkdown aligns frontmatter, removes title tag, and clears image alt text', () => {
  const input = [
    '<title>逐字稿实操：从入门到高手</title>',
    '',
    '# 开始上课',
    '',
    '![一大段图片描述](https://feishu.cn/file/boxcn123)',
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
  assert.match(content, /\n# 开始上课\n/);
  assert.match(content, /!\[]\(https:\/\/internal-api-drive-stream\.feishu\.cn\/space\/api\/box\/stream\/download\/v2\/cover\/boxcn123\/\)/);
  assert.match(content, /!\[]\(https:\/\/internal-api-drive-stream\.feishu\.cn\/space\/api\/box\/stream\/download\/v2\/cover\/boxcn456\/\)/);
});
