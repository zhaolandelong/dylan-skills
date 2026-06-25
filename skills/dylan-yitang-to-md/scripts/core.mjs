import * as cheerio from 'cheerio';
import TurndownService from 'turndown';
import path from 'node:path';
import crypto from 'node:crypto';

export function isProbablyYitangDocUrl(input) {
  try {
    const u = new URL(input);
    const hostname = String(u.hostname || '').toLowerCase();
    const pathname = String(u.pathname || '');

    if ((hostname === 'yitang.top' || hostname.endsWith('.yitang.top')) && pathname.startsWith('/fs-doc/')) {
      return true;
    }

    if (hostname === 'yitanger.feishu.cn' && /^\/docx\/[A-Za-z0-9]+(?:\/|$)/.test(pathname)) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

export function isFeishuDocxUrl(input) {
  try {
    const u = new URL(input);
    const hostname = String(u.hostname || '').toLowerCase();
    const pathname = String(u.pathname || '');
    return hostname === 'yitanger.feishu.cn' && /^\/docx\/[A-Za-z0-9]+(?:\/|$)/.test(pathname);
  } catch {
    return false;
  }
}

export function extractTitleTagContent(text) {
  const match = String(text || '').match(/<title>([\s\S]*?)<\/title>/i);
  return String(match?.[1] || '').trim();
}

export function normalizeContentHtml(contentHtml) {
  const $ = cheerio.load(`<div id="__root__">${contentHtml}</div>`);
  const $root = $('#__root__');

  $root.find('script,style,iframe,noscript').remove();

  function escapeHtml(s) {
    return String(s || '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  $root.find('[class*="heading"]').each((_, el) => {
    const $el = $(el);
    const cls = String($el.attr('class') || '').toLowerCase();
    const m = cls.match(/heading([1-6])/);
    if (!m) return;
    const level = Math.min(6, Math.max(1, Number.parseInt(m[1], 10) || 1));
    const text = String($el.text() || '')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .trim()
      .replace(/\s+/g, ' ');
    $el.replaceWith(`<h${level}>${escapeHtml(text)}</h${level}>`);
  });

  $root.find('.docx-quote_container-block').each((_, el) => {
    const $el = $(el);
    $el.replaceWith(`<blockquote>${$el.html() || ''}</blockquote>`);
  });

  $root.find('.textHighlight').each((_, el) => {
    const $el = $(el);
    $el.replaceWith(`<em><strong>${$el.html() || ''}</strong></em>`);
  });

  $root.find('.text-highlight-background').each((_, el) => {
    const $el = $(el);
    $el.replaceWith(`<mark><strong>${$el.html() || ''}</strong></mark>`);
  });

  $root.find('.bold').each((_, el) => {
    const $el = $(el);
    if ($el.parents('h1,h2,h3,h4,h5,h6').length) {
      $el.replaceWith($el.html() || '');
      return;
    }
    $el.replaceWith(`<strong>${$el.html() || ''}</strong>`);
  });

  $root.find('h1 strong, h2 strong, h3 strong, h4 strong, h5 strong, h6 strong').each((_, el) => {
    const $el = $(el);
    $el.replaceWith($el.html() || '');
  });

  $root.find('table').each((_, el) => {
    const $table = $(el);
    if ($table.find('thead').length) return;

    const $tbody = $table.find('tbody').first();
    const $rows = $tbody.length ? $tbody.children('tr') : $table.children('tr');
    if (!$rows.length) return;

    const $first = $rows.first();
    const headerCells = $first.children('td,th').toArray().map((cell) => $(cell).html() || '');
    $first.remove();

    const headHtml = `<thead><tr>${headerCells.map((c) => `<th>${c}</th>`).join('')}</tr></thead>`;
    $table.prepend(headHtml);

    if (!$tbody.length) {
      const remaining = $table.children('tr').toArray().map((tr) => $(tr).toString());
      $table.children('tr').remove();
      $table.append(`<tbody>${remaining.join('')}</tbody>`);
    }
  });

  $root.find('*').each((_, parent) => {
    const $parent = $(parent);
    const kids = $parent.children().toArray();
    if (!kids.length) return;

    function blockType(node) {
      const cls = String($(node).attr('class') || '').toLowerCase();
      if (cls.includes('docx-ordered-block')) return 'ol';
      if (cls.includes('docx-bullet-block')) return 'ul';
      return '';
    }

    for (let i = 0; i < kids.length; i += 1) {
      const t = blockType(kids[i]);
      if (!t) continue;

      const start = i;
      let end = i + 1;
      while (end < kids.length && blockType(kids[end]) === t) end += 1;

      const $list = $(`<${t}></${t}>`);
      let firstNum = null;

      for (let k = start; k < end; k += 1) {
        const $block = $(kids[k]);
        let n = null;
        if (t === 'ol') {
          const raw = String($block.find('.orderUnedit').first().text() || '').trim();
          const m = raw.match(/\d+/);
          if (m) n = Number.parseInt(m[0], 10);
          $block.find('.orderUnedit').remove();
        }
        $block.find('.bulletUnedit').remove();
        const itemHtml = $block.html() || '';
        const $li = $(`<li>${itemHtml}</li>`);
        if (t === 'ol' && firstNum == null && Number.isFinite(n)) firstNum = n;
        $list.append($li);
      }

      if (t === 'ol' && firstNum != null && firstNum > 1) $list.attr('start', String(firstNum));

      $(kids[start]).before($list);
      for (let k = start; k < end; k += 1) $(kids[k]).remove();

      i = start;
    }
  });

  $root.find('img').each((_, el) => {
    const $img = $(el);
    const src =
      $img.attr('data-src') ||
      $img.attr('data-original') ||
      $img.attr('data-lazy-src') ||
      $img.attr('data-actualsrc') ||
      $img.attr('src');

    if (src) $img.attr('src', src);

    const alt = $img.attr('alt') || '';
    for (const key of Object.keys($img.attr() || {})) {
      if (key !== 'src' && key !== 'alt') $img.removeAttr(key);
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

  service.addRule('mark', {
    filter: 'mark',
    replacement(content) {
      const c = String(content || '').trim();
      return c ? `==${c}==` : '';
    }
  });

  service.addRule('br', {
    filter: 'br',
    replacement() {
      return '\n';
    }
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

  service.addRule('table', {
    filter: 'table',
    replacement(_content, node) {
      const table = node;
      const rows = Array.from(table.querySelectorAll?.('tr') || []);
      if (!rows.length) return '';

      const rowCells = rows.map((tr) => Array.from(tr.querySelectorAll?.('th,td') || []));
      const colCount = Math.max(1, ...rowCells.map((cells) => cells.length));

      function cellText(cell) {
        const t = String(cell?.textContent || '')
          .replace(/[\u200B-\u200D\uFEFF]/g, '')
          .replace(/\s+/g, ' ')
          .trim();
        return t.replaceAll('|', '\\|');
      }

      function normalizeRow(cells) {
        const out = [];
        for (let i = 0; i < colCount; i += 1) out.push(cellText(cells[i]));
        return out;
      }

      const header = normalizeRow(rowCells[0]);
      const sep = header.map(() => '---');
      const body = rowCells.slice(1).map(normalizeRow);

      const lines = [
        `| ${header.join(' | ')} |`,
        `| ${sep.join(' | ')} |`,
        ...body.map((r) => `| ${r.join(' | ')} |`)
      ];
      return `\n\n${lines.join('\n')}\n\n`;
    }
  });

  const md = service.turndown(html);
  return ensureTrailingNewline(postProcessMarkdown(md));
}

export function postProcessMarkdown(markdown) {
  const lines = String(markdown || '').replace(/\r/g, '').split('\n');
  const out = [];
  let inFence = false;

  for (const line of lines) {
    if (/^```/.test(line)) {
      inFence = !inFence;
      out.push(line);
      continue;
    }
    if (inFence) {
      out.push(line);
      continue;
    }
    out.push(processInlineWithoutCode(line));
  }

  return out.join('\n');

  function processInlineWithoutCode(line) {
    const s = String(line || '');
    const parts = [];
    let i = 0;

    while (i < s.length) {
      const tickStart = s.indexOf('`', i);
      if (tickStart < 0) {
        parts.push(processMarkers(s.slice(i)));
        break;
      }
      const tickLen = countRun(s, tickStart, '`');
      const tickEnd = s.indexOf('`'.repeat(tickLen), tickStart + tickLen);
      if (tickEnd < 0) {
        parts.push(processMarkers(s.slice(i)));
        break;
      }
      parts.push(processMarkers(s.slice(i, tickStart)));
      parts.push(s.slice(tickStart, tickEnd + tickLen));
      i = tickEnd + tickLen;
    }

    return parts.join('');
  }

  function countRun(str, start, ch) {
    let j = start;
    while (j < str.length && str[j] === ch) j += 1;
    return j - start;
  }

  function processMarkers(s) {
    const raw = String(s);
    const withBoldItalicUnderscore = raw.replace(/\*\*_(?=\S)/g, '**_ ');

    const withTripleAsterisk = withBoldItalicUnderscore.replace(/\*\*\*(?=[\p{L}\p{N}])/gu, (m, offset, str) => {
      if (offset <= 0) return m;
      const prev = str[offset - 1];
      if (/\s/.test(prev)) return m;
      const before = str.slice(0, offset);
      if (!before.includes('***')) return m;
      return '*** ';
    });

    const withHighlight = withTripleAsterisk.replace(/==(?=[\p{L}\p{N}])/gu, (m, offset, str) => {
      if (offset <= 0) return m;
      const prev = str[offset - 1];
      if (/\s/.test(prev)) return m;
      const before = str.slice(0, offset);
      if (!before.includes('==')) return m;
      return '== ';
    });

    return withHighlight;
  }
}

export function filenameBaseFromTitle(title) {
  const raw = String(title || '').normalize('NFC');
  const cleaned = raw
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\/\\:\*\?"<>\|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '');

  let base = cleaned || 'yitang-doc';
  if (base.startsWith('.')) base = `_${base.slice(1) || 'yitang-doc'}`;

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

export function getCandidateFilenames(title) {
  const base = filenameBaseFromTitle(title);
  return [base, `${base}-2`, `${base}-3`, `${base}-4`, `${base}-5`].map((s) => `${s}.md`);
}

export function buildArticleId(sourceUrl) {
  const u = String(sourceUrl || '').trim();
  const hash = crypto.createHash('sha1').update(u).digest('hex').slice(0, 12);
  return `yt-${hash}`;
}

export function buildFrontmatter({ title, sourceUrl, fetchedAt }) {
  const t = String(title || '').replace(/\n/g, ' ').trim();
  const u = String(sourceUrl || '').trim();
  const f = String(fetchedAt || '').trim();
  const a = buildArticleId(u);

  return ['---', `article_id: ${jsonString(a)}`, `title: ${jsonString(t)}`, `source_url: ${jsonString(u)}`, `fetched_at: ${jsonString(f)}`, '---', ''].join(
    '\n'
  );
}

export function buildCookieHeaderFromList(cookies) {
  const pairs = [];
  const seen = new Set();

  for (const cookie of cookies || []) {
    const name = String(cookie?.name || '').trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    pairs.push(`${name}=${String(cookie?.value || '')}`);
  }

  return pairs.join('; ');
}

export function buildEmbeddedDownloadCookieComment(cookieHeader) {
  const value = String(cookieHeader || '').trim();
  if (!value) return '';
  return `<!-- dylan-download-md-img-cookie: ${Buffer.from(value).toString('base64url')} -->`;
}

export function buildMarkdownDoc({ title, sourceUrl, fetchedAt, contentMarkdown, embeddedDownloadCookie = '' }) {
  const frontmatter = buildFrontmatter({ title, sourceUrl, fetchedAt });
  const cookieComment = buildEmbeddedDownloadCookieComment(embeddedDownloadCookie);
  const body = ensureTrailingNewline(String(contentMarkdown || ''));
  if (!cookieComment) return frontmatter + body;
  return `${frontmatter}${cookieComment}\n\n${body}`;
}

export function ensureTrailingNewline(s) {
  return s.endsWith('\n') ? s : `${s}\n`;
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
  if (!raw) return '';
  if (path.isAbsolute(raw)) return raw;
  return path.resolve(cwd, raw);
}

export function pickOutDir({ cliOutDir, configOutDir, cwd, homeDir }) {
  const chosen = cliOutDir || configOutDir || '';
  const resolved = resolveOutDirPath(chosen, cwd, homeDir);
  if (!resolved) {
    throw new Error('缺少 outDir：请通过 --out 或 skills/dylan-yitang-to-md/config.json 配置 outDir');
  }
  return resolved;
}

function jsonString(s) {
  return JSON.stringify(s);
}
