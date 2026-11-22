// Hiểu câu tìm: làm MỘT lần cho mọi nhánh. Mỗi nhánh sau đó chỉ lấy phần mình hiểu (view) và lập từ tìm riêng.
// Port từ experiments/natural-search/search/core/query.py.
import { LEX } from './lexicon.js';
import { NAME_MIN, NS, type Stats } from './stats.js';
import { ABBR, DAYS, accWords, fold, hasMarks, normTokens, words } from './text.js';

// Luật cấu trúc (số tiền, số ngày): không liệt kê được nên để regex.
const MONEY = /\b(duoi|toi da|khong qua|max|tam|khoang)?\s*(\d+(?:[.,]\d+)?)\s*(tr|trieu|cu|k|nghin)\s*(\d)?\b/;

/** 'duoi 3tr' -> 3_000_000; '1tr5' -> 1_500_000; 'tam 2 cu' -> 2_200_000 (tầm = +10%). Trả [số, đoạn khớp]. */
export function budgetOf(t: string): [number, string] | [null, null] {
  const m = MONEY.exec(t);
  if (!m) return [null, null];
  let v = Number(m[2]!.replace(',', '.'));
  const unit = m[3] === 'k' || m[3] === 'nghin' ? 1_000 : 1_000_000;
  if (m[4] && unit === 1_000_000) v += Number(m[4]) / 10;
  v *= unit * (m[1] === 'tam' || m[1] === 'khoang' ? 1.1 : 1);
  return [Math.trunc(v), m[0]];
}

/** [cụm, loại, nhóm] đã khớp lexicon. */
export type Matched = [phrase: string, type: string, bucket: string];

export interface Understood {
  place: string | null;
  intents: string[];
  concepts: string[];
  terms: string[];
  /** Loại cụ thể (homestay...) kèm trọng số. */
  subtypes: Array<[string, number]>;
  budget: number | null;
  days: number | null;
  matched: Matched[];
  seq: string[];
  /** Dạng bỏ dấu -> dạng có dấu người dùng gõ. */
  accents: Record<string, string>;
  soft: string[];
  quality: boolean;
  qmods: string[];
  fixed: Record<string, string>;
  names: string[];
  phrases: string[];
  unknown: string[];
}

const replaceAll = (s: string, a: string, b: string) => s.split(a).join(b);

/** 'ngày 3': số đứng sau chữ. Vừa có thể là chuyến 3 ngày, vừa có thể là "ngày thứ 3" (vlog), nên understand() giữ cả cách hiểu theo chữ. */
const DAYS_AFTER = /\bngay (\d+)\b/;

/** hasDaysSlot=false: không tách số ngày thành ô, giữ '3 ngày' làm từ tìm (cách hiểu theo chữ). */
export function parse(q: string, fix?: ReadonlyMap<string, string>, folded: string = fold(q), options: { hasDaysSlot?: boolean } = {}): Understood {
  let t = ` ${folded} `;
  const [budget, raw] = budgetOf(t); // trước khi đổi teencode ('500k' không thành '500 khong')
  if (raw) t = replaceAll(t, raw, ' ');
  t = normTokens(t, fix);
  const dm = options.hasDaysSlot === false ? null : (DAYS.exec(t) ?? DAYS_AFTER.exec(t));
  const days = dm ? Number(dm[1] ?? dm[2]) : null;
  if (dm) t = replaceAll(t, dm[0], ' ');
  let place: string | null = null;
  const intents: string[] = [];
  const concepts: string[] = [];
  const terms: string[] = [];
  const kept: Array<[string, number]> = [];
  const matched: Matched[] = [];
  const seq: string[] = [];
  const soft: string[] = [];
  const qmods: string[] = [];
  for (const [ph, hits] of LEX.segment(words(t))) {
    if (!hits) {
      if (!LEX.stop.has(ph)) {
        terms.push(ph);
        seq.push(ph);
      }
      continue;
    }
    if (!hits.some(([typ]) => typ === 'place')) seq.push(...ph.split(' ')); // 'ca phe' + 'trung' -> cặp 'phe_trung'
    for (const [typ, b, w] of hits) {
      matched.push([ph, typ, b]);
      if (typ === 'place' && !place) place = b;
      else if (typ === 'intent') {
        if (!intents.includes(b)) intents.push(b);
        if (w) kept.push([ph, w]);
      } else if (typ === 'concept') {
        // Từ bổ nghĩa: cộng điểm, không tự làm object đủ điều kiện.
        if (!concepts.includes(b)) concepts.push(b);
        terms.push(ph);
        if (LEX.soft.has(b)) soft.push(ph);
        if (w > 0 && !qmods.includes(b)) qmods.push(b); // 'ngon' = người dùng muốn chỗ chất lượng
      }
    }
  }
  if (days && !intents.includes('plan')) intents.push('plan');
  const accents: Record<string, string> = {};
  for (const w of accWords(q)) if (hasMarks(w)) accents[fold(w).trim()] = w;
  return {
    place, intents, concepts, terms, subtypes: kept, budget, days, matched, seq, accents, soft,
    quality: qmods.length > 0, qmods, fixed: {}, names: [], phrases: [], unknown: [],
  };
}

// ---------------- Sửa lỗi gõ
const RARE = 2; // từ có trong <= RARE tài liệu là "lạ"
/** Dạng âm tiết tiếng Việt (đã bỏ dấu): phụ âm đầu? + nguyên âm + phụ âm cuối hợp lệ. */
const SYLLABLE = /^(ngh|ng|nh|ch|gh|gi|kh|ph|qu|th|tr|[bcdghklmnpqrstvx])?[aeiouy]{1,3}(ch|ng|nh|[cmnpt])?$/;
/** Trọng số cách hiểu theo câu gốc khi đã có cách hiểu đã sửa (câu đã sửa nặng 1). Gộp kết quả: max(trọng số · rank). */
export const ORIGINAL_WEIGHT = 0.6;
/** Trọng số cách hiểu "theo chữ" của cụm số ngày ('3 ngày' là từ tìm, không phải ô số ngày), so với cách hiểu theo ô. */
export const DAYS_TEXT_WEIGHT = 0.8;
/** Mỗi lần sửa một chữ trừ chừng này vào log(df): sửa 2 chữ cần ứng viên phổ biến hơn ~e^TYPO_LAMBDA lần. */
const TYPO_LAMBDA = 3;

/** Khoảng cách Damerau-Levenshtein (bản OSA): thiếu, thừa, đổi một chữ, đảo hai chữ liền nhau đều tính 1. */
export function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i ? (j ? 0 : i) : j)));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1);
    }
  }
  return d[a.length]![b.length]!;
}

/** Số chữ được phép sai theo độ dài từ gõ: từ ngắn sai một chữ đã thành từ khác. */
export const maxEdits = (len: number) => (len >= 8 ? 2 : len >= 4 ? 1 : 0);

/** Độ giống như difflib.SequenceMatcher.ratio (Ratcliff/Obershelp): 2·M / (|a| + |b|). */
export function ratio(a: string, b: string): number {
  const pos = new Map<string, number[]>();
  for (let j = 0; j < b.length; j++) pos.set(b[j]!, [...(pos.get(b[j]!) ?? []), j]); // cùng cách đánh chỉ số với a[i]
  let matches = 0;
  const queue: Array<[number, number, number, number]> = [[0, a.length, 0, b.length]];
  while (queue.length) {
    const [alo, ahi, blo, bhi] = queue.pop()!;
    let [bi, bj, size] = [alo, blo, 0];
    let lens = new Map<number, number>();
    for (let i = alo; i < ahi; i++) {
      const next = new Map<number, number>();
      for (const j of pos.get(a[i]!) ?? []) {
        if (j < blo) continue;
        if (j >= bhi) break;
        const k = (lens.get(j - 1) ?? 0) + 1;
        next.set(j, k);
        if (k > size) [bi, bj, size] = [i - k + 1, j - k + 1, k];
      }
      lens = next;
    }
    if (!size) continue;
    matches += size;
    if (alo < bi && blo < bj) queue.push([alo, bi, blo, bj]);
    if (bi + size < ahi && bj + size < bhi) queue.push([bi + size, ahi, bj + size, bhi]);
  }
  return a.length + b.length ? (2 * matches) / (a.length + b.length) : 1;
}

/**
 * Từ lạ/hiếm -> từ gần nhất trong toàn bộ từ vựng (mọi nhánh + lexicon). 'trug' -> trung.
 * Kênh nhiễu: điểm = log(df + 1) − TYPO_LAMBDA · số chữ sai. Từ chỉ có trong lexicon (df 0) vẫn là ứng viên nhưng
 * không được ưu tiên hơn từ có trong dữ liệu: khi dữ liệu còn ít, độ giống quyết định trước, độ phổ biến sau.
 */
export async function typoFix(ws: readonly string[], st: Stats): Promise<Map<string, string>> {
  // ponytail: chỉ xét ứng viên cùng chữ cái đầu; sai chữ cái đầu của tên nơi do placeFix lo, từ thường thì chưa sửa
  await st.load(ws.map((key) => ({ ns: NS.df, key })));
  const fix = new Map<string, string>();
  for (const w of ws) {
    const f = st.df(w);
    // Từ đã có trong dữ liệu (df > 0) là từ thật, kể cả khi hiếm: không sửa. Viết tắt -> không sửa.
    if (w.length < 3 || f > 0 || LEX.vocab.has(w) || LEX.stop.has(w) || ABBR.test(w)) continue;
    await st.loadTypoPool(w);
    const limit = Math.max(1, maxEdits(w.length));
    let best: { c: string; score: number } | null = null;
    for (const c of st.typoCandidates(w)) {
      if (c === w || Math.abs(c.length - w.length) > limit) continue;
      const d = editDistance(w, c);
      if (d > limit || st.df(c) <= f) continue; // ứng viên phải phổ biến hơn từ gõ
      const score = Math.log(st.df(c) + 1) - TYPO_LAMBDA * d;
      if (!best || score > best.score || (score === best.score && c < best.c)) best = { c, score };
    }
    if (best) fix.set(w, best.c);
  }
  return fix;
}

/** Tên nơi trong lexicon (bí danh 'nha trang', 'dalat') + tên riêng nhập tay nhiều chữ: đích sửa cả cụm. */
const PLACE_NAMES: ReadonlyArray<readonly [name: string, key: string]> = [
  ...[...LEX.phrase].filter(([, hits]) => hits.some(([t]) => t === 'place')).map(([t]) => t),
  ...[...LEX.names.keys()].filter((n) => n.includes(' ')),
]
  .filter((n) => n.split(' ').join('').length >= 4 && !ABBR.test(n))
  .map((n) => [n, n.split(' ').join('')] as const);

/**
 * 'nha trag' -> 'nha trang', 'nah trang' -> 'nha trang', 'da lta' -> 'da lat': so cụm 1-3 từ (có ít nhất một từ lạ) với tên nơi,
 * trên khoá bỏ khoảng trắng, cho sai tới maxEdits chữ. Tên nơi là tập nhỏ, cố định, không phụ thuộc dữ liệu: chạy được cả khi chỉ mục còn ít.
 */
export async function placeFix(folded: string, st: Stats): Promise<[text: string, fixed: Record<string, string>]> {
  const ws = words(folded);
  const alpha = (w: string) => /^[a-z]+$/.test(w);
  await st.load(ws.filter(alpha).map((key) => ({ ns: NS.df, key })));
  // Như typoFix: chỉ cụm có từ KHÔNG có trong dữ liệu mới là gõ sai ('hau giang', 'tran dang' có thật thì giữ).
  const isStrange = (w: string) => alpha(w) && !st.df(w) && !LEX.vocab.has(w) && !LEX.stop.has(w) && !LEX.phrase.has(w);
  const out: string[] = [];
  const fixed: Record<string, string> = {};
  for (let i = 0; i < ws.length; ) {
    let taken = 0;
    for (let k = Math.min(3, ws.length - i); k >= 1 && !taken; k--) {
      const win = ws.slice(i, i + k);
      const text = win.join(' ');
      if (!win.every(alpha) || !win.some(isStrange) || LEX.phrase.has(text) || LEX.names.has(text)) continue;
      const key = win.join('');
      let best: { name: string; d: number } | null = null;
      for (const [name, nk] of PLACE_NAMES) {
        // Ngưỡng theo độ dài tên đích: gõ thiếu 2 chữ làm khoá ngắn đi, nhưng tên dài vẫn đủ phân biệt.
        const limit = maxEdits(nk.length);
        if (Math.abs(nk.length - key.length) > limit) continue;
        const d = editDistance(key, nk);
        if (d <= limit && (!best || d < best.d || (d === best.d && name.length > best.name.length))) best = { name, d };
      }
      if (best && best.name !== text) {
        out.push(best.name);
        fixed[text] = best.name;
        taken = k;
      }
    }
    if (!taken) out.push(ws[i]!);
    i += taken || 1;
  }
  return [out.join(' '), fixed];
}

// ---------------- Ghép/tách chữ: so khớp sau khi bỏ khoảng trắng
const SQUASH_MAX_WORDS = 3;
const SQUASH_EXACT_MIN = 5; // khoá ngắn hơn 5 ký tự không thử: quá dễ trùng ngẫu nhiên
const SQUASH_FUZZY_MIN = 7; // dưới 7 ký tự không cho lệch: 'hanoi' ~ 'hanol' là rác
const SQUASH_FUZZY_RATIO = 0.9;
const noSpace = (s: string) => s.split(' ').join('');

/**
 * 'sunworld' -> 'sun world', 'lot te' -> 'lotte', 'lotte cetner' -> 'lotte center': bỏ khoảng trắng ở cả câu lẫn từ điển rồi so.
 * Đích = từ đơn (df > 0 hoặc lexicon) và cụm nhiều từ (tên đường, chuỗi, cụm tiêu đề, tên nhập tay).
 * Chỉ nhận khi đích có SỐ TỪ KHÁC cụm gõ (ghép, tách); cùng số từ thì typoFix lo.
 * Chỉ thử cụm chứa ít nhất một từ "lạ" (hiếm, không thuộc lexicon): 'quan an', 'ha noi' gồm toàn từ quen nên không bao giờ bị ghép.
 * Nhận khi khoá trùng khít (>= 5 ký tự) hoặc ratio >= 0,9 (>= 7 ký tự). Từ đơn -> từ đơn là việc của typoFix nên bỏ qua.
 * Trả câu đã bỏ dấu sau khi thay, và các chỗ đã sửa { cụm gõ: dạng chuẩn }.
 */
export async function squashFix(folded: string, st: Stats): Promise<[text: string, joined: Record<string, string>]> {
  const ws = words(folded);
  const alpha = (w: string) => /^[a-z]+$/.test(w);
  await st.load(ws.filter(alpha).map((key) => ({ ns: NS.df, key })));
  const isStrange = (w: string) =>
    alpha(w) && w.length >= 2 && st.df(w) <= RARE && !LEX.vocab.has(w) && !LEX.stop.has(w) && !LEX.phrase.has(w) && !ABBR.test(w);
  const out: string[] = [];
  const joined: Record<string, string> = {};
  for (let i = 0; i < ws.length; ) {
    let taken = 0;
    for (let k = Math.min(SQUASH_MAX_WORDS, ws.length - i); k >= 1 && !taken; k--) {
      const win = ws.slice(i, i + k);
      const sq = noSpace(win.join(' '));
      const text = win.join(' ');
      if (!win.every(alpha) || sq.length < SQUASH_EXACT_MIN || !win.some(isStrange)) continue;
      if (LEX.phrase.has(text) || LEX.normPh.has(text) || LEX.names.has(text)) continue; // từ điển đã hiểu cụm này
      if (k === 1 && (LEX.norm.has(text) || st.df(text) > 0)) continue; // từ đã có trong dữ liệu thì khớp thẳng được, không tách
      if (k > 1) {
        // Cụm đã xuất hiện trong dữ liệu (hoặc là tên riêng) là người dùng gõ đúng: 'dong khoi' là tên đường, không ghép thành 'dongkhoi'.
        await st.load([NS.ngram, NS.street, NS.brand, NS.brandPlaces, NS.titleGram].map((ns) => ({ ns, key: text })));
        if (st.get(NS.ngram, text) > 0 || st.isName(text)) continue;
      }
      await st.loadPhrasePool(sq);
      if (k > 1) await st.loadTypoPool(sq);
      const singles = k > 1 ? st.typoCandidates(sq) : [];
      let best: { c: string; score: number } | null = null;
      for (const c of [...singles, ...st.phraseCandidates(sq)]) {
        const cs = noSpace(c);
        // Cùng số từ là việc của typoFix (từng từ một); ở đây chỉ xử lý khi số từ khác: ghép, tách.
        // Đích có chữ số ('vincom dong khoi 5' từ tiêu đề 'Vincom Đồng Khởi: 5 quán') không phải tên: câu gõ chỉ có chữ cái.
        if (c.split(' ').length === k || Math.abs(cs.length - sq.length) > 2 || /\d/.test(c)) continue;
        // Đích có từ một chữ cái ('tuan s') thường là mảnh vỡ của tiêu đề, không phải tên.
        if (c.split(' ').some((w) => w.length < 2)) continue;
        // Gần đúng chỉ cho cùng độ dài (gõ nhầm/đảo chữ): thiếu hay thừa chữ ('tamihouse' ~ 'tam house') sai nhiều hơn đúng.
        const score = cs === sq ? 1 : sq.length >= SQUASH_FUZZY_MIN && cs.length === sq.length ? ratio(cs, sq) : 0;
        if (score < (cs === sq ? 1 : SQUASH_FUZZY_RATIO)) continue;
        if (!best || score > best.score || (score === best.score && c < best.c)) best = { c, score };
      }
      if (best) {
        out.push(best.c);
        joined[text] = best.c;
        taken = k;
      }
    }
    if (!taken) out.push(ws[i]!);
    i += taken || 1;
  }
  return [out.join(' '), joined];
}

/** Cắt chuỗi từ thành tên riêng dài nhất (2-4 âm tiết) + từ lẻ. 'vincom dong khoi' -> [vincom][dong khoi]. */
export function nameSegment(seq: readonly string[], isName: (ph: string) => boolean, maxn = 4): string[][] {
  const out: string[][] = [];
  let i = 0;
  while (i < seq.length) {
    let n = 1;
    for (let k = Math.min(maxn, seq.length - i); k > 1; k--) {
      if (isName(seq.slice(i, i + k).join(' '))) {
        n = k;
        break;
      }
    }
    out.push(seq.slice(i, i + n));
    i += n;
  }
  return out;
}

/** Một cách hiểu câu và độ tin của nó. */
export interface Interpretation {
  u: Understood;
  weight: number;
  isOriginal: boolean;
}

/**
 * Hiểu câu: sửa ghép/tách, sửa tên nơi, parse, sửa lỗi gõ từng từ, tách tên riêng, tách cụm dính, đánh dấu từ lạ.
 * Có sửa thì trả HAI cách hiểu: câu đã sửa (nặng 1) và câu gốc (nặng ORIGINAL_WEIGHT); bên tìm chạy cả hai rồi gộp kết quả,
 * nên sửa nhầm không làm mất kết quả của câu gốc. Không sửa gì thì chỉ có câu gốc. Phần tử đầu là cách hiểu chính.
 */
export async function understand(q: string, st: Stats): Promise<Interpretation[]> {
  const folded = fold(q);
  const [squashed, joined] = await squashFix(folded, st);
  const [text, placed] = await placeFix(squashed, st);
  const u1 = parse(q, undefined, text);
  await st.loadSeq(u1.seq);
  const keep = new Set(nameSegment(u1.seq, (ph) => st.isName(ph)).filter((g) => g.length > 1).flat()); // chữ thuộc tên riêng: không sửa
  // Từ gõ có dấu và đúng dạng âm tiết là người dùng cố ý gõ ('dịp' không phải gõ sai của 'đi'), dù dữ liệu chưa có từ đó:
  // không sửa. Có dấu nhưng sai dạng ('trứg') vẫn sửa.
  const typed = (w: string) => Object.hasOwn(u1.accents, w) && SYLLABLE.test(w);
  const fix = await typoFix(u1.terms.filter((w) => !w.includes(' ') && !keep.has(w) && !typed(w)), st);
  const fixed = { ...joined, ...placed, ...Object.fromEntries(fix) };
  const hasFix = Object.keys(fixed).length > 0;
  // Câu có số ngày: thêm cách hiểu theo chữ, giữ đúng thứ tự chữ đã gõ (cụm phải khớp liền, '3 ngày' ≠ 'ngày 3').
  // '3 ngày' = chuyến 3 ngày: cách hiểu theo ô nặng hơn. 'ngày 3' = ngày thứ 3 (vlog): cách hiểu theo chữ nặng hơn.
  // Cách hiểu theo ô luôn đứng trước, vì `understood` lấy từ cách hiểu đầu (FE dùng days cho nút "Bỏ số ngày").
  const variants = async (fixArg: ReadonlyMap<string, string> | undefined, src: string, weight: number, isOriginal: boolean) => {
    const u = await finish(parse(q, fixArg, src), st);
    if (!isOriginal) u.fixed = fixed;
    if (u.days === null) return [{ u, weight, isOriginal }];
    const asText = await finish(parse(q, fixArg, src, { hasDaysSlot: false }), st);
    if (!isOriginal) asText.fixed = fixed;
    const t = ` ${src} `;
    const lead = DAYS.exec(t);
    const isDayIndex = !lead;
    const phrase = isDayIndex ? `ngay ${u.days}` : lead[2] ? `${u.days} ngay` : null; // '3n2đ' là một từ, không cần cụm
    if (phrase) asText.phrases.push(phrase);
    const [slotW, textW] = isDayIndex ? [DAYS_TEXT_WEIGHT, 1] : [1, DAYS_TEXT_WEIGHT];
    return [
      { u, weight: weight * slotW, isOriginal },
      { u: asText, weight: weight * textW, isOriginal },
    ];
  };
  const original = await variants(undefined, folded, hasFix ? ORIGINAL_WEIGHT : 1, true);
  return hasFix ? [...(await variants(fix.size ? fix : undefined, text, 1, false)), ...original] : original;
}

/** Phần hiểu câu sau parse: tên riêng, cụm dính, ý muốn giả trong tên đường, nơi theo tên riêng, từ lạ. */
async function finish(u: Understood, st: Stats): Promise<Understood> {
  await st.loadSeq(u.seq);
  const segs = nameSegment(u.seq, (ph) => st.isName(ph));
  u.names = segs.filter((g) => g.length > 1).map((g) => g.join(' ')); // tên riêng: phải khớp nguyên cụm
  u.phrases = [...u.names];
  let run: string[] = [];
  for (const g of [...segs, []]) {
    if (g.length === 1) {
      run.push(g[0]!);
      continue;
    }
    u.phrases.push(...st.segment(run).filter((x) => x.length > 1).map((x) => x.join(' ')));
    run = [];
  }
  // 'Đặng Văn Ngữ': 'ngu' là tên đường, không phải 'ngủ'.
  const nameWords = new Set(u.names.filter((n) => st.get(NS.street, n) >= NAME_MIN).flatMap((n) => n.split(' ')));
  u.intents = u.intents.filter(
    (b) => !u.matched.some(([ph, typ, b2]) => typ === 'intent' && b2 === b && ph.split(' ').every((x) => nameWords.has(x))),
  );
  if (!u.place) u.place = u.names.map((n) => LEX.names.get(n)).find(Boolean) ?? null; // 'hồ tây' -> Hà Nội
  const single = u.terms.filter((w) => !w.includes(' '));
  await st.load(single.map((key) => ({ ns: NS.df, key })));
  u.unknown = single.filter((w) => !st.df(w)); // từ lạ -> ứng viên thêm vào lexicon
  return u;
}

/** Phần câu một nhánh hiểu: bỏ từ bổ nghĩa nhánh không dùng ('ngon' không có nghĩa với chỗ ở). mods=null: giữ hết. */
export function view(u: Understood, mods: ReadonlySet<string> | null): Understood {
  if (!mods) return u;
  const drop = new Set(u.matched.filter(([, typ, b]) => typ === 'concept' && LEX.soft.has(b) && !mods.has(b)).map(([ph]) => ph));
  if (!drop.size) return u;
  const qmods = u.qmods.filter((b) => mods.has(b) || !LEX.soft.has(b));
  const dw = new Set([...drop].flatMap((p) => p.split(' ')));
  return {
    ...u,
    terms: u.terms.filter((t) => !drop.has(t)),
    soft: u.soft.filter((t) => !drop.has(t)),
    seq: u.seq.filter((w) => !dw.has(w)),
    concepts: u.concepts.filter((c) => !LEX.soft.has(c) || mods.has(c)),
    matched: u.matched.filter(([ph]) => !drop.has(ph)),
    qmods,
    quality: qmods.length > 0,
  };
}

/** Từ tìm có trọng số kèm dạng có dấu bắt buộc. */
export type QueryTerm = [term: string, weight: number, accents: string[]];

/** Từ đơn 1, cặp liền kề 0,5 + 1,5·NPMI, loại cụ thể, viết tắt #lx, thành viên chủ đề 0,5. */
export function queryTerms(u: Understood, st: Stats | null): QueryTerm[] {
  const q = new Map<string, number>(u.terms.map((w) => [w.replace(/ /g, '_'), 1]));
  const ws = new Set(u.terms.flatMap((w) => w.split(' ')));
  const seq = u.seq.length ? u.seq : u.terms.flatMap((w) => w.split(' '));
  // Cặp liền kề (kiểu SDM): nặng theo độ dính của cụm trên dữ liệu. 'com tam' 0.5→~2, 'tam long' ~0.5.
  const pw = (a: string, b: string) => (st ? 0.5 + 1.5 * Math.max(0, st.npmi(a, b)) : 1.5);
  for (let i = 0; i + 1 < seq.length; i++) {
    const [a, b] = [seq[i]!, seq[i + 1]!];
    if (ws.has(a) || ws.has(b)) q.set(`${a}_${b}`, pw(a, b));
  }
  const setDefault = (t: string, w: number) => {
    if (!q.has(t)) q.set(t, w);
  };
  for (const [p, w] of u.subtypes) setDefault(p.replace(/ /g, '_'), w);
  for (const w of u.terms) if (ABBR.test(w) && !LEX.vocab.has(w)) setDefault(`#${w}`, 1); // 'lx' -> '#lx' (Long Xuyên)
  for (const c of u.concepts) for (const m of LEX.membersOf('concept', c)) setDefault(m.replace(/ /g, '_'), 0.5);
  // Các từ trong term được gõ có dấu -> tài liệu phải có đúng dạng đó.
  const acc = (t: string) => t.split('_').flatMap((p) => (Object.hasOwn(u.accents, p) ? [u.accents[p]!] : []));
  return [...q].map(([t, w]) => [t, w, acc(t)]);
}

/** Từ tìm của một nhánh cho một cách hiểu. Câu gốc và câu đã sửa được tìm riêng rồi gộp kết quả (rank.ts), không trộn từ. */
export async function branchTerms(u: Understood, st: Stats, mods: ReadonlySet<string> | null): Promise<[Understood, QueryTerm[]]> {
  const v = view(u, mods);
  await st.loadSeq(v.seq);
  return [v, queryTerms(v, st)];
}
