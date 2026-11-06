// Chuẩn hoá chữ, dùng chung cho câu tìm lẫn tài liệu ở mọi nhánh. Port từ experiments/natural-search/search/core/text.py.
// Lưu ý: \b của JS chỉ hiểu chữ ASCII, nên với chữ có dấu dùng lookaround \p{L} thay cho \b.
import { LEX } from './lexicon.js';
import type { ExploreObject } from './types.js';

/** Tách theo khoảng trắng, bỏ chuỗi rỗng (như str.split() của Python). */
export const words = (s: string): string[] => s.split(/\s+/).filter(Boolean);

// Chính tả i/y: âm tiết chỉ có một nguyên âm i/y sau phụ âm đầu viết kiểu nào cũng được (mỳ = mì, kỹ = kĩ).
// Gộp về i ở cả chỉ mục lẫn câu tìm. 'y' không dấu giữ nguyên (my/by tiếng Anh). Sau 'qu' thì gộp về y (quí = quý).
const IY: Record<string, string> = { ỳ: 'ì', ý: 'í', ỷ: 'ỉ', ỹ: 'ĩ', ỵ: 'ị' };
const IY_BACK: Record<string, string> = { i: 'y', ì: 'ỳ', í: 'ý', ỉ: 'ỷ', ĩ: 'ỹ', ị: 'ỵ' };
const NOT_WORD_BEFORE = '(?<![\\p{L}\\p{N}_])';
const NOT_WORD_AFTER = '(?![\\p{L}\\p{N}_])';
const SPELL = new RegExp(`${NOT_WORD_BEFORE}(ch|gh|kh|ng|nh|ph|th|tr|[bcdđhklmnprstvx])([ỳýỷỹỵ])${NOT_WORD_AFTER}`, 'gu');
const QUI = new RegExp(`${NOT_WORD_BEFORE}qu([iìíỉĩị])${NOT_WORD_AFTER}`, 'gu');
const MARK = /\p{Mn}/u;

export function spell(s: string | null | undefined): string {
  // OSM hay gõ Ð (eth) thay cho Đ.
  const t = (s ?? '').toLowerCase().normalize('NFC').replace(/ð/g, 'đ');
  return t.replace(SPELL, (_, c: string, v: string) => c + IY[v]).replace(QUI, (_, v: string) => `qu${IY_BACK[v]}`);
}

/** Bỏ dấu, chỉ giữ [a-z0-9 ]. emoji=true: đổi emoji thành chữ (chỉ cho câu tìm). */
export function fold(s: string | null | undefined, options: { emoji?: boolean } = {}): string {
  let t = spell(s);
  if (options.emoji ?? true) for (const [e, w] of LEX.raw) t = t.split(e).join(w);
  t = t.replace(/đ/g, 'd').normalize('NFD').replace(/\p{Mn}/gu, '');
  return t.replace(/[^a-z0-9]+/g, ' ');
}

// Dạng có dấu: người dùng gõ dấu thì tôn trọng dấu (trứng ≠ Trung). Chuẩn hoá vị trí dấu kiểu cũ/mới (hoà = hòa).
const TONE: Array<[string, string]> = [
  ['oà', 'òa'], ['oá', 'óa'], ['oả', 'ỏa'], ['oã', 'õa'], ['oạ', 'ọa'],
  ['oè', 'òe'], ['oé', 'óe'], ['oẻ', 'ỏe'], ['oẽ', 'õe'], ['oẹ', 'ọe'],
  ['uỳ', 'ùy'], ['uý', 'úy'], ['uỷ', 'ủy'], ['uỹ', 'ũy'], ['uỵ', 'ụy'],
];

export function accWords(s: string | null | undefined): string[] {
  let t = spell(s);
  for (const [a, b] of TONE) t = t.split(a).join(b);
  return words(t.replace(/[^\p{L}\p{N}]+/gu, ' '));
}

export function hasMarks(s: string | null | undefined): boolean {
  const t = s ?? '';
  return MARK.test(t.normalize('NFD')) || t.toLowerCase().includes('đ');
}

/** Văn bản tiếng Việt có dấu thật: >= 20% từ có dấu. Mô tả tiếng Anh lẫn vài tên 'Lăng Cô' vẫn tính là không dấu. */
export function isVi(s: string | null | undefined): boolean {
  const w = words(s ?? '');
  return w.length > 0 && w.filter(hasMarks).length >= 0.2 * w.length;
}

export function normTokens(s: string, fix?: ReadonlyMap<string, string>): string {
  const out = words(s).map((w0) => {
    let w = w0.replace(/([a-z])\1{2,}/g, '$1'); // ngonnn -> ngon
    w = fix?.get(w) ?? w;
    return LEX.norm.get(w) ?? w;
  });
  const joined = out.join(' ');
  return LEX.normRe ? joined.replace(LEX.normRe, (m) => LEX.normPh.get(m)!) : joined;
}

export const norm = (s: string | null | undefined, options: { emoji?: boolean } = {}): string => normTokens(fold(s, options));

/** Âm tiết tiếng Việt luôn có nguyên âm -> chuỗi toàn phụ âm là viết tắt. */
export const ABBR = /^[bcdfghjklmnpqrstvwxz]{2,4}$/;

/** Viết tắt của tài liệu: chữ cái đầu của mọi cụm 2-4 âm tiết liền nhau. 'Long Xuyên' -> #lx. */
export function abbrs(text: string): string[] {
  const w = words(fold(text));
  const out: string[] = [];
  for (const n of [2, 3, 4]) for (let i = 0; i + n <= w.length; i++) out.push('#' + w.slice(i, i + n).map((x) => x[0]).join(''));
  return out;
}

/** Từ đơn + cặp liền kề. emoji -> chữ chỉ cho câu tìm, không cho tài liệu. */
export function toks(text: string, options: { emoji?: boolean } = {}): string[] {
  const w = words(norm(text, { emoji: options.emoji ?? false }));
  return [...w, ...w.slice(1).map((b, i) => `${w[i]}_${b}`)];
}

const ADDR_WORDS = new Set(['duong', 'd', 'pho', 'ngo', 'hem', 'kiet', 'so', 'street', 'st', 'road', 'rd', 'quoc', 'lo', 'p', 'q']);
const hasDigit = (s: string) => /\d/.test(s);

/** Tên riêng trong địa chỉ (đường, phường, quận): '235 Đường Ðồng Khởi, Quận 1' -> ['dong khoi']. 2-4 âm tiết, không số. */
export function streetsOf(o: Pick<ExploreObject, 'addr'>): string[] {
  const out: string[] = [];
  for (const seg of (o.addr ?? '').split(',')) {
    let w = words(norm(seg, { emoji: false }));
    while (w.length && (ADDR_WORDS.has(w[0]!) || hasDigit(w[0]!))) w = w.slice(1);
    while (w.length && ADDR_WORDS.has(w[w.length - 1]!)) w = w.slice(0, -1);
    if (w.length >= 2 && w.length <= 4 && !w.some(hasDigit)) out.push(w.join(' '));
  }
  return out;
}

const LEX_WORDS = new Set([...LEX.phrase.keys(), ...LEX.tier.keys(), ...LEX.stop]);
const PLACE_TERMS = new Set([...LEX.phrase].filter(([, hits]) => hits.some((h) => h[0] === 'place')).map(([t]) => t));

/**
 * Tên có thể là chuỗi: tên bỏ phần chi nhánh ('Pizza Hut - CN Q1', 'Pizza Hut Nguyễn Trãi' với địa chỉ Nguyễn Trãi -> 'pizza hut').
 * Bỏ tên chứa nơi hoặc chỉ gồm từ lexicon ('khách sạn', 'cà phê').
 */
export function brandOf(title: string, streets: readonly string[]): string | null {
  let w = words(norm(title.split(/\s[-–|:]\s|[(,;|]/)[0], { emoji: false }));
  while (w.length && hasDigit(w[w.length - 1]!)) w = w.slice(0, -1);
  for (const s of streets) {
    const sw = s.split(' ');
    if (w.length > sw.length && w.slice(-sw.length).join(' ') === s) w = w.slice(0, -sw.length);
  }
  if (w.length < 2 || w.length > 4 || w.every((x) => LEX_WORDS.has(x))) return null;
  for (let i = 0; i < w.length; i++) for (let j = i + 1; j <= w.length; j++) if (PLACE_TERMS.has(w.slice(i, j).join(' '))) return null;
  return w.join(' ');
}

export function titleGrams(title: string): Set<string> {
  const w = words(norm(title, { emoji: false }));
  const out = new Set<string>();
  for (const k of [2, 3, 4]) for (let i = 0; i + k <= w.length; i++) out.add(w.slice(i, i + k).join(' '));
  return out;
}

/** Phần chữ đưa vào thống kê cụm: tên, từng đoạn khu vực, và mô tả thật (review mô phỏng làm méo độ dính). */
export function statParts(o: ExploreObject): string[][] {
  const parts = [o.title, ...(o.area ?? '').split(',')];
  if (!o.sim) parts.push(words(o.text ?? '').slice(0, 300).join(' '));
  return parts.map((x) => words(norm(x, { emoji: false })));
}

/** Các nhóm loại `type` xuất hiện trong text (dùng cho cả câu tìm lẫn tài liệu). */
export function bucketsIn(text: string, type: string): string[] {
  const seen: string[] = [];
  for (const [, hits] of LEX.segment(words(norm(text)))) {
    for (const [t, b] of hits ?? []) if (t === type && !seen.includes(b)) seen.push(b);
  }
  return seen;
}

export const destOf = (text: string): string | null => bucketsIn(text, 'place')[0] ?? null;

/** 3n2đ · 3 ngày · 3 ngày 2 đêm (trên chữ đã bỏ dấu). */
export const DAYS = /\b(\d+) ?n ?\d+ ?d\b|\b(\d+) ngay(?: \d+ dem)?\b/;

export function topicsOf(text: string): Set<string> {
  const keep = new Set(['food', 'cafe', 'stay', 'see', 'plan']);
  const t = new Set(bucketsIn(text, 'intent').filter((b) => keep.has(b)));
  if (DAYS.test(norm(text))) t.add('plan');
  return t;
}

/** Tầm theo lexicon (bậc cao nhất gặp trong tên/loại). 'Areca Resort & Hotel' -> cao cap. */
export function tierOf(text: string): readonly [string, number] | null {
  const w = words(norm(text, { emoji: false }));
  let best: readonly [string, number] | null = null;
  for (const n of [1, 2, 3]) {
    for (let i = 0; i + n <= w.length; i++) {
      const t = LEX.tier.get(w.slice(i, i + n).join(' '));
      if (t && (!best || t[1] > best[1])) best = t;
    }
  }
  return best;
}

/** Tên nói rõ hơn loại (OSM hay gắn homestay là 'hotel'). */
export const objTier = (o: Pick<ExploreObject, 'title' | 'subtype'>) => tierOf(o.title) ?? tierOf(o.subtype ?? '');

export function km(a: { lat?: number | null; lon?: number | null }, b: { lat?: number | null; lon?: number | null }): number | null {
  if (a.lat == null || a.lon == null || b.lat == null || b.lon == null) return null;
  const r = Math.PI / 180;
  const [la1, lo1, la2, lo2] = [a.lat * r, a.lon * r, b.lat * r, b.lon * r];
  const h = Math.sin((la2 - la1) / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin((lo2 - lo1) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}
