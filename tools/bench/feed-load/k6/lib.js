// TF120: phần dùng chung cho 3 kịch bản k6 đo tải feed trên staging. Mọi request đều là khách (không đăng nhập).
import http from 'k6/http';
import { fail } from 'k6';

export const BASE_URL = __ENV.BASE_URL || 'https://api.tripflix.io.vn';
export const API = `${BASE_URL}/api/v1`;
export const TREND_STATS = ['count', 'avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'];
export const JSON_HEADERS = { 'Content-Type': 'application/json' };

/** UUID v4 tự sinh, để không phải tải jslib từ mạng. */
export function uuid() {
  const h = '0123456789abcdef';
  let s = '';
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) s += '-';
    else if (i === 14) s += '4';
    else if (i === 19) s += h[8 + Math.floor(Math.random() * 4)];
    else s += h[Math.floor(Math.random() * 16)];
  }
  return s;
}

export function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

/** Một trang feed của khách. `cursor` null là trang đầu. */
export function feedPage({ tab = 'for_you', cursor = null, limit = 10, tags } = {}) {
  const q = [`tab=${tab}`, `limit=${limit}`];
  if (cursor) q.push(`cursor=${encodeURIComponent(cursor)}`);
  return http.get(`${API}/feed?${q.join('&')}`, { tags });
}

/**
 * Đi `pages` trang của một tab như người lướt, trả về thẻ và cursor từng trang.
 * Dùng trong setup để có sẵn bài và cursor, lượt đo không phải đi lại từ đầu.
 */
export function walkFeed(tab, pages) {
  const cards = [];
  const cursors = [];
  let cursor = null;
  for (let i = 0; i < pages; i++) {
    const res = feedPage({ tab, cursor, tags: { name: 'setup' } });
    if (res.status !== 200) fail(`Feed ${tab} trang ${i + 1}: ${res.status} ${res.body}`);
    const page = res.json();
    cards.push(...page.items);
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
    cursors.push(cursor);
  }
  return { cards, cursors };
}

/** Cookie CloudFront của khách, ghép thành header Cookie như app (app không nhận Set-Cookie). */
export function playbackCookie(tags = { name: 'playback_session' }) {
  const res = http.post(`${API.replace('/v1', '')}/media/playback-session`, null, { tags });
  if (res.status !== 200) return { res, cookie: null, expiresAt: 0 };
  const body = res.json();
  const cookie = Object.entries(body.cookies || {})
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
  return { res, cookie, expiresAt: body.expiresAt ? Date.parse(body.expiresAt) : Date.now() + 10 * 60_000 };
}

/** Đường dẫn tương đối trong m3u8 → URL tuyệt đối. */
export function resolveUrl(base, ref) {
  if (/^https?:\/\//.test(ref)) return ref;
  const dir = base.split('?')[0].replace(/[^/]*$/, '');
  return dir + ref;
}

/** Biến thể trong master.m3u8: chọn mức cao nhất không quá `maxHeight` (trần 540p trên 4G, docs/10). */
export function pickVariant(masterUrl, text, maxHeight = 540) {
  const lines = text.split('\n').map((l) => l.trim());
  const variants = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('#EXT-X-STREAM-INF')) continue;
    const m = /RESOLUTION=\d+x(\d+)/.exec(lines[i]);
    const uri = lines[i + 1];
    if (uri && !uri.startsWith('#'))
      variants.push({ height: m ? Number(m[1]) : 0, url: resolveUrl(masterUrl, uri) });
  }
  if (variants.length === 0) return null;
  const ok = variants.filter((v) => v.height <= maxHeight).sort((a, b) => b.height - a.height);
  return (ok[0] || variants.sort((a, b) => a.height - b.height)[0]).url;
}

/** URL các đoạn video trong playlist của một biến thể. */
export function segmentUrls(playlistUrl, text) {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => resolveUrl(playlistUrl, l));
}
