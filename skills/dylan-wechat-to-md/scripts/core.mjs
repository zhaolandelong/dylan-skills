import * as cheerio from 'cheerio';
import TurndownService from 'turndown';
import path from 'node:path';
import crypto from 'node:crypto';

export function isProbablyWechatArticleUrl(input) {
  try {
    const u = new URL(input);
    return u.hostname === 'mp.weixin.qq.com' && u.pathname.startsWith('/s');
  } catch {
    return false;
  }
}

export function extractWechatArticle(html, sourceUrl) {
  if (looksLikeWechatBlockedPage(html)) {
    throw new Error(
      '疑似被微信风控拦截(环境异常/verify)。可尝试在浏览器打开后携带 Cookie 运行：--cookie "<cookie>"，或写入 skills/dylan-wechat-to-md/config.json'
    );
  }

  const $ = cheerio.load(html);
  const title =
    $('meta[property="og:title"]').attr('content')?.trim() ||
    $('meta[name="og:title"]').attr('content')?.trim() ||
    $('title').text().trim() ||
    'wechat-article';

  const $content =
    $('#js_content').first().length
      ? $('#js_content').first()
      : $('.rich_media_content').first().length
        ? $('.rich_media_content').first()
        : $('article').first().length
          ? $('article').first()
          : $();

  if (!$content.length) {
    throw new Error('正文节点未找到');
  }

  const rawHtml = $content.html() || '';
  const contentHtml = normalizeContentHtml(rawHtml);

  if (!contentHtml.trim()) {
    throw new Error('正文为空');
  }

  return { title, sourceUrl, contentHtml };
}

export function looksLikeWechatBlockedPage(html) {
  const s = String(html || '');
  if (!s) return false;
  if (s.includes('js_content')) return false;
  if (s.includes('环境异常')) return true;
  if (s.includes('访问过于频繁')) return true;
  if (s.includes('verify') && s.includes('mp.weixin.qq.com') && s.includes('weui')) return true;
  return false;
}

export function normalizeContentHtml(contentHtml) {
  const $ = cheerio.load(`<div id="__root__">${contentHtml}</div>`);
  const $root = $('#__root__');

  $root.find('script,style,iframe,noscript').remove();

  $root.find('img').each((_, el) => {
    const $img = $(el);
    const src =
      $img.attr('data-src') ||
      $img.attr('data-original') ||
      $img.attr('data-actualsrc') ||
      $img.attr('src');

    if (src) {
      $img.attr('src', src);
    }

    const alt = $img.attr('alt') || '';
    for (const key of Object.keys($img.attr() || {})) {
      if (key !== 'src' && key !== 'alt') {
        $img.removeAttr(key);
      }
    }
    $img.attr('alt', alt);
  });

  return $root.html() || '';
}

export function htmlToMarkdown(html) {
  const service = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced'
  });

  service.addRule('img', {
    filter: 'img',
    replacement(_content, node) {
      const el = node;
      const src = el.getAttribute?.('src') || '';
      const alt = el.getAttribute?.('alt') || '';
      const safeAlt = alt.replace(/\n/g, ' ').trim();
      return src ? `![${safeAlt}](${src})` : '';
    }
  });

  const md = service.turndown(html);
  return ensureTrailingNewline(md);
}

export function filenameBaseFromTitle(title) {
  const raw = String(title || '').normalize('NFC');
  const cleaned = raw
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\/\\:\*\?"<>\|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '');

  let base = cleaned || 'wechat-article';
  if (base.startsWith('.')) base = `_${base.slice(1) || 'wechat-article'}`;

  const upper = base.toUpperCase();
  const reserved =
    upper === 'CON' ||
    upper === 'PRN' ||
    upper === 'AUX' ||
    upper === 'NUL' ||
    /^COM[1-9]$/.test(upper) ||
    /^LPT[1-9]$/.test(upper);
  if (reserved) base = `${base}_`;

  return base.length > 120 ? base.slice(0, 120).trim() : base;
}

export function buildFrontmatter({ title, sourceUrl, fetchedAt }) {
  const t = String(title || '').replace(/\n/g, ' ').trim();
  const u = String(sourceUrl || '').trim();
  const f = String(fetchedAt || '').trim();
  const a = buildArticleId(u);

  return [
    '---',
    `article_id: ${jsonString(a)}`,
    `title: ${jsonString(t)}`,
    `source_url: ${jsonString(u)}`,
    `fetched_at: ${jsonString(f)}`,
    '---',
    ''
  ].join('\n');
}

export function buildMarkdownDoc({ title, sourceUrl, fetchedAt, contentMarkdown }) {
  return (
    buildFrontmatter({ title, sourceUrl, fetchedAt }) +
    ensureTrailingNewline(String(contentMarkdown || ''))
  );
}

export function buildArticleId(sourceUrl) {
  const u = String(sourceUrl || '').trim();
  const hash = crypto.createHash('sha1').update(u).digest('hex').slice(0, 12);
  return `wx-${hash}`;
}

export function expandTildePath(inputPath, homeDir) {
  const p = String(inputPath || '');
  if (p === '~') return homeDir;
  if (!/^~[\\/]/.test(p)) return p;
  const rest = p.slice(2);
  return path.join(homeDir, rest);
}

export function resolveOutDirPath(outDir, cwd, homeDir) {
  const raw = expandTildePath(outDir, homeDir);
  if (!raw) return path.resolve(cwd, 'wechat-md');
  if (path.isAbsolute(raw)) return raw;
  return path.resolve(cwd, raw);
}

export function pickOutDir({ cliOutDir, configOutDir, cwd, homeDir }) {
  const chosen = cliOutDir || configOutDir || './wechat-md';
  return resolveOutDirPath(chosen, cwd, homeDir);
}

export function getCandidateFilenames(slug) {
  const base = filenameBaseFromTitle(slug);
  return [base, `${base}-2`, `${base}-3`, `${base}-4`, `${base}-5`].map(
    (s) => `${s}.md`
  );
}

export function ensureTrailingNewline(s) {
  return s.endsWith('\n') ? s : `${s}\n`;
}

function jsonString(s) {
  return JSON.stringify(s);
}
