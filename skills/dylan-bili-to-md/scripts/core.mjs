import path from 'node:path';
import crypto from 'node:crypto';

const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
  27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
  37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
  22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
];

export function isProbablyBilibiliVideoUrl(input) {
  try {
    const u = new URL(input);
    if (u.hostname === 'www.bilibili.com' || u.hostname === 'bilibili.com') {
      return u.pathname.startsWith('/video/');
    }
    return u.hostname === 'b23.tv';
  } catch {
    return false;
  }
}

export function parseBilibiliVideoUrl(input) {
  const u = new URL(input);
  const p = normalizeP(u.searchParams.get('p'));

  if (u.hostname === 'b23.tv') {
    return { bvid: null, aid: null, p };
  }

  const m = u.pathname.match(/^\/video\/([^/]+)\/?/);
  if (!m) return { bvid: null, aid: null, p };
  const id = m[1];

  if (/^BV[0-9A-Za-z]+$/.test(id)) return { bvid: id, aid: null, p };
  if (/^av\d+$/i.test(id)) return { bvid: null, aid: Number(id.slice(2)), p };
  return { bvid: null, aid: null, p };
}

export function pickPreferredSubtitle(subtitles) {
  const list = Array.isArray(subtitles) ? subtitles : [];
  if (!list.length) return null;

  const langOrder = ['zh-CN', 'zh-Hans', 'zh', 'zh-TW', 'en'];
  const sourceOrder = ['cc', 'ai', 'unknown'];

  const scored = list
    .map((s, idx) => {
      const lang = String(s?.lan || '').trim();
      const source = classifySubtitleSource(s);
      const url = getSubtitleUrl(s);
      const sourceRank = sourceOrder.indexOf(source);
      const langRank = langOrder.indexOf(lang);
      return {
        subtitle: s,
        lang: lang || 'unknown',
        source,
        url,
        score: [
          url ? 0 : 1,
          sourceRank === -1 ? 999 : sourceRank,
          langRank === -1 ? 999 : langRank,
          idx,
        ],
      };
    })
    .sort((a, b) => compareScore(a.score, b.score));

  const best = scored[0];
  return { ...best, url: normalizeSubtitleUrl(best.url) };
}

export function normalizeSubtitleUrl(input) {
  const s = String(input || '').trim();
  if (!s) return '';
  if (s.startsWith('//')) return `https:${s}`;
  if (s.startsWith('http://') || s.startsWith('https://')) return s;
  return s.startsWith('/') ? `https://i0.hdslb.com${s}` : s;
}

export function subtitleBodyToPlainText(body) {
  const rows = Array.isArray(body) ? body : [];
  const lines = [];
  let last = '';
  for (const r of rows) {
    const s = String(r?.content || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!s) continue;
    if (s === last) continue;
    lines.push(s);
    last = s;
  }
  return ensureTrailingNewline(lines.join('\n'));
}

export function filenameBaseFromTitle(title) {
  const raw = String(title || '').normalize('NFC');
  const cleaned = raw
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\/\\:\*\?"<>\|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '');

  let base = cleaned || 'bilibili-subtitle';
  if (base.startsWith('.')) base = `_${base.slice(1) || 'bilibili-subtitle'}`;

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

export function buildOutputFilename({ title, p, lang }) {
  const base = filenameBaseFromTitle(title);
  const safeLang = filenameBaseFromTitle(lang).replace(/\s+/g, '-');
  const suffix = p && p > 1 ? `-p${p}` : '';
  return `${base}${suffix}-${safeLang}.md`;
}

export function buildArticleId(sourceUrl) {
  const u = String(sourceUrl || '').trim();
  if (!u) return 'bili-unknown';
  const hash = crypto.createHash('sha1').update(u).digest('hex').slice(0, 12);
  return `bili-${hash}`;
}

export function buildFrontmatter({ title, sourceUrl, fetchedAt }) {
  const t = String(title || '').replace(/\n/g, ' ').trim();
  const u = String(sourceUrl || '').trim();
  const f = String(fetchedAt || '').trim();
  const a = buildArticleId(u);

  return [
    '---',
    `article_id: ${JSON.stringify(a)}`,
    `title: ${JSON.stringify(t)}`,
    `source_url: ${JSON.stringify(u)}`,
    `fetched_at: ${JSON.stringify(f)}`,
    '---',
    '',
  ].join('\n');
}

export function buildMarkdownDoc({ title, sourceUrl, fetchedAt, contentMarkdown }) {
  return buildFrontmatter({ title, sourceUrl, fetchedAt }) + ensureTrailingNewline(String(contentMarkdown || ''));
}

export function extractWbiKeys(navData) {
  const imgUrl = String(navData?.wbi_img?.img_url || '').trim();
  const subUrl = String(navData?.wbi_img?.sub_url || '').trim();
  const imgKey = extractWbiKeyFromUrl(imgUrl);
  const subKey = extractWbiKeyFromUrl(subUrl);
  if (!imgKey || !subKey) return null;
  return { imgKey, subKey };
}

export function encodeWbiParams(params, { imgKey, subKey, now = Math.floor(Date.now() / 1000) }) {
  const mixinKey = getMixinKey(String(imgKey || '') + String(subKey || ''));
  const chrFilter = /[!'()*]/g;
  const withWts = { ...(params || {}), wts: now };
  const query = Object.keys(withWts)
    .sort()
    .map((key) => {
      const value = String(withWts[key] ?? '').replace(chrFilter, '');
      return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
    })
    .join('&');
  const wRid = crypto.createHash('md5').update(query + mixinKey).digest('hex');
  return `${query}&w_rid=${wRid}`;
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
  const chosen = cliOutDir || configOutDir;
  if (!chosen) return '';
  return resolveOutDirPath(chosen, cwd, homeDir);
}

function normalizeP(p) {
  const n = Number(p);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.floor(n);
}

function classifySubtitleSource(s) {
  const t = Number(s?.subtitle_type ?? s?.type);
  if (t === 1) return 'cc';
  if (t === 2) return 'ai';
  return 'unknown';
}

function getSubtitleUrl(s) {
  return normalizeSubtitleUrl(
    s?.url || s?.subtitle_url || s?.subtitleUrl || s?.subtitleURL
  );
}

function extractWbiKeyFromUrl(input) {
  const s = String(input || '').trim();
  if (!s) return '';
  try {
    const u = new URL(s);
    return path.basename(u.pathname, path.extname(u.pathname));
  } catch {
    return '';
  }
}

function getMixinKey(orig) {
  return MIXIN_KEY_ENC_TAB.map((n) => orig[n] || '').join('').slice(0, 32);
}

function compareScore(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x - y;
  }
  return 0;
}

function ensureTrailingNewline(s) {
  return s.endsWith('\n') ? s : `${s}\n`;
}
