import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  extractWechatArticle,
  htmlToMarkdown,
  slugify,
  getCandidateFilenames,
  filenameBaseFromTitle,
  looksLikeWechatBlockedPage,
  expandTildePath,
  resolveOutDirPath,
  pickOutDir
} from '../skills/dylan-wechat-to-md/scripts/core.mjs';

test('extractWechatArticle extracts title and normalizes img src', () => {
  const html = `
    <html>
      <head>
        <meta property="og:title" content="测试标题 A" />
        <title>fallback</title>
      </head>
      <body>
        <div id="js_content">
          <p>第一段</p>
          <img data-src="https://example.com/a.png" />
        </div>
      </body>
    </html>
  `;

  const result = extractWechatArticle(html, 'https://mp.weixin.qq.com/s/abc');
  assert.equal(result.title, '测试标题 A');
  assert.match(result.contentHtml, /<img[^>]+src="https:\/\/example\.com\/a\.png"/);
});

test('htmlToMarkdown keeps image url', () => {
  const md = htmlToMarkdown('<p>第一段</p><img src="https://example.com/a.png" />');
  assert.match(md, /第一段/);
  assert.match(md, /!\[[^\]]*\]\(https:\/\/example\.com\/a\.png\)/);
});

test('slugify produces stable filename base', () => {
  assert.equal(slugify('Hello World'), 'hello-world');
  assert.equal(slugify('  '), 'wechat-article');
});

test('getCandidateFilenames keeps title as base', () => {
  const list = getCandidateFilenames('Hello World');
  assert.deepEqual(list.slice(0, 3), ['Hello World.md', 'Hello World-2.md', 'Hello World-3.md']);
});

test('filenameBaseFromTitle strips invalid characters cross-platform', () => {
  assert.equal(filenameBaseFromTitle('a/b:c*?"<>|d'), 'a b c d');
  assert.equal(filenameBaseFromTitle('   '), 'wechat-article');
});

test('expandTildePath supports ~ and ~/...', () => {
  const homeDir = process.platform === 'win32' ? 'C:\\Users\\dylan' : '/home/dylan';
  assert.equal(expandTildePath('~', homeDir), homeDir);
  assert.equal(expandTildePath('~/a/b', homeDir), path.join(homeDir, 'a/b'));
  assert.equal(expandTildePath('~\\a\\b', homeDir), path.join(homeDir, 'a\\b'));
});

test('resolveOutDirPath resolves relative/empty paths cross-platform', () => {
  const cwd = process.platform === 'win32' ? 'C:\\work\\repo' : '/work/repo';
  const homeDir = process.platform === 'win32' ? 'C:\\Users\\dylan' : '/home/dylan';

  assert.equal(resolveOutDirPath('', cwd, homeDir), path.resolve(cwd, 'wechat-md'));
  assert.equal(resolveOutDirPath('./x', cwd, homeDir), path.resolve(cwd, './x'));
  assert.equal(resolveOutDirPath('~/x', cwd, homeDir), path.resolve(path.join(homeDir, 'x')));
});

test('pickOutDir precedence: cli > config > default', () => {
  const cwd = process.platform === 'win32' ? 'C:\\work\\repo' : '/work/repo';
  const homeDir = process.platform === 'win32' ? 'C:\\Users\\dylan' : '/home/dylan';

  assert.equal(
    pickOutDir({ cliOutDir: './cli', configOutDir: './cfg', cwd, homeDir }),
    path.resolve(cwd, './cli')
  );
  assert.equal(
    pickOutDir({ cliOutDir: '', configOutDir: './cfg', cwd, homeDir }),
    path.resolve(cwd, './cfg')
  );
  assert.equal(
    pickOutDir({ cliOutDir: '', configOutDir: '', cwd, homeDir }),
    path.resolve(cwd, './wechat-md')
  );
});

test('looksLikeWechatBlockedPage detects risk-control html', () => {
  const html = `
    <html>
      <head><title>环境异常</title></head>
      <body>
        <div>环境异常</div>
        <script>var url="https://mp.weixin.qq.com"</script>
      </body>
    </html>
  `;
  assert.equal(looksLikeWechatBlockedPage(html), true);
});

test('looksLikeWechatBlockedPage does not match normal article html', () => {
  const html = `
    <html>
      <head><title>x</title></head>
      <body>
        <div id="js_content"><p>ok</p></div>
        <script>var verify=1; var host="mp.weixin.qq.com";</script>
      </body>
    </html>
  `;
  assert.equal(looksLikeWechatBlockedPage(html), false);
});

test('extractWechatArticle throws readable error when blocked', () => {
  const html = `
    <html>
      <head><title>环境异常</title></head>
      <body>环境异常 verify mp.weixin.qq.com</body>
    </html>
  `;

  assert.throws(
    () => extractWechatArticle(html, 'https://mp.weixin.qq.com/s/abc'),
    /风控拦截/
  );
});
