import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMarkdownDoc, extractTitleTagContent, filenameBaseFromTitle, htmlToMarkdown, isFeishuDocxUrl, isProbablyYitangDocUrl, normalizeContentHtml, postProcessMarkdown } from './core.mjs';

test('postProcessMarkdown adds space after emphasis close markers', () => {
  assert.equal(postProcessMarkdown('_**hi**_世界'), '_**hi**_ 世界');
  assert.equal(postProcessMarkdown('***hi***世界'), '***hi*** 世界');
  assert.equal(postProcessMarkdown('***hi*** 世界'), '***hi*** 世界');
});

test('postProcessMarkdown does not touch code spans or fenced code blocks', () => {
  assert.equal(postProcessMarkdown('`***hi***世界`'), '`***hi***世界`');
  assert.equal(postProcessMarkdown('``***hi***世界``'), '``***hi***世界``');

  const input = ['```js', 'const x = \"***hi***世界\"', '```', '***hi***世界'].join('\n');
  const expected = ['```js', 'const x = \"***hi***世界\"', '```', '***hi*** 世界'].join('\n');
  assert.equal(postProcessMarkdown(input), expected);
});

test('isProbablyYitangDocUrl only accepts yitang and yitanger feishu docx urls', () => {
  assert.equal(isProbablyYitangDocUrl('https://yitang.top/fs-doc/abc123'), true);
  assert.equal(isProbablyYitangDocUrl('https://yitanger.feishu.cn/docx/EGl2dAkwMoQXTzxGGAgcZlNhnoe'), true);
  assert.equal(isProbablyYitangDocUrl('https://other.feishu.cn/docx/EGl2dAkwMoQXTzxGGAgcZlNhnoe'), false);
  assert.equal(isProbablyYitangDocUrl('https://yitanger.feishu.cn/wiki/abc123'), false);
});

test('isFeishuDocxUrl and extractTitleTagContent work for lark-cli markdown', () => {
  assert.equal(isFeishuDocxUrl('https://yitanger.feishu.cn/docx/EGl2dAkwMoQXTzxGGAgcZlNhnoe'), true);
  assert.equal(isFeishuDocxUrl('https://yitang.top/fs-doc/abc123'), false);
  assert.equal(extractTitleTagContent('<title>逐字稿实操：从入门到高手</title>\n# 开始上课'), '逐字稿实操：从入门到高手');
});

test('normalizeContentHtml converts heading blocks to h1/h2', () => {
  const html = [
    '<div class="block docx-heading1-block"><span class="bold">开始上课</span></div>',
    '<div class="block docx-heading2-block">为什么要学这节课</div>'
  ].join('');

  const out = normalizeContentHtml(html);
  assert.match(out, /<h1>开始上课<\/h1>/);
  assert.match(out, /<h2>为什么要学这节课<\/h2>/);
});

test('filenameBaseFromTitle removes zero width characters', () => {
  assert.equal(filenameBaseFromTitle('全员必修\u200b'), '全员必修');
});

test('htmlToMarkdown turns heading + highlight rules into expected markdown', () => {
  const html = [
    '<div class="block docx-heading1-block">开始上课</div>',
    '<p><span class="bold textHighlight">强调</span>世界</p>',
    '<p><span class="text-highlight-background">高亮</span>世界</p>'
  ].join('');

  const md = htmlToMarkdown(normalizeContentHtml(html));
  assert.match(md, /^# 开始上课/m);
  assert.match(md, /(_\*\*强调\*\*_|(\*\*\*强调\*\*\*)) 世界/);
  assert.match(md, /==\*\*高亮\*\*== 世界/);
});

test('buildMarkdownDoc can embed download cookie comment', () => {
  const doc = buildMarkdownDoc({
    title: '逐字稿实操：从入门到高手',
    sourceUrl: 'https://yitanger.feishu.cn/docx/EGl2dAkwMoQXTzxGGAgcZlNhnoe',
    fetchedAt: '2026-06-26T00:00:00.000Z',
    contentMarkdown: '# 开始上课\n',
    embeddedDownloadCookie: 'session=abc; passport=xyz'
  });

  assert.match(doc, /^---\narticle_id:/);
  assert.match(doc, /<!-- dylan-download-md-img-cookie: [A-Za-z0-9_-]+ -->/);
  assert.match(doc, /\n# 开始上课\n/);
});
