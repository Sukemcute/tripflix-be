// Tìm khám phá: HIỂU CÂU một lần -> mỗi NHÁNH lấy ứng viên rồi chấm BM25, độ phủ, luật dấu, chất lượng, độ gần -> GỘP theo vùng.
// Port từ experiments/natural-search/search/engine.py + verticals/*.py; giữ nguyên công thức để so được với bộ câu thử.
import { LEX } from './lexicon.js';
import { branchTerms, understand, type Interpretation, type QueryTerm, type Understood } from './query.js';
import { NS, Stats } from './stats.js';
import { km } from './text.js';
import type { ExploreObject, ExploreSource, IndexedDoc } from './types.js';

export const NEAR_KM = 40; // 'gần đó': bán kính quanh tâm nơi (Hội An–Đà Nẵng ~25 km)
const USER_W = 0.35; // gần người dùng: nặng 35%
const USER_KM = 2; // cách USER_KM thì còn nửa điểm
const K1 = 1.2;
const B = 0.75;

export const SECTIONS: ReadonlyArray<readonly [kind: string, label: string]> = [
  ['food', 'Ăn gì'],
  ['cafe', 'Cà phê'],
  ['see', 'Chơi gì · check-in'],
  ['stay', 'Ở đâu'],
  ['plan', 'Lộ trình'],
  ['post', 'Bài viết'],
  ['video', 'Video'],
];

export function bayesQuality(o: ExploreObject): number {
  // Sao Bayes (mốc 3,8, k = 10) × 0,8 + log số review × 0,2. Không có review: có trong cẩm nang 0,45, không có gì 0,35.
  if (o.n && o.rating != null) {
    const b = (o.rating * o.n + 3.8 * 10) / (o.n + 10);
    return Math.max(0, Math.min(1, (b - 3) / 2)) * 0.8 + Math.min(1, Math.log10(o.n + 1) / 3) * 0.2;
  }
  return o.src === 'Wikivoyage' ? 0.45 : 0.35;
}

const starsReason = (o: ExploreObject): string[] =>
  o.rating ? [`★${o.rating.toFixed(1)} · ${o.n ?? 0} review${o.sim ? ' (mô phỏng)' : ''}`] : [];

const budgetNote = (u: Understood, isOverBudget: boolean) => (!u.budget ? '' : isOverBudget ? ' · vượt ngân sách' : ' · trong ngân sách');

const SOFT_BUT_NGON = new Set([...LEX.soft].filter((b) => b !== 'ngon')); // 'ngon' với chỗ ở, điểm chơi chỉ là nhiễu

/** Một nhánh = một nhóm loại object, cùng chỉ mục và cách chấm. */
interface Vertical {
  name: string;
  /** Nhóm bổ nghĩa nhánh hiểu; null = mọi nhóm. */
  mods: ReadonlySet<string> | null;
  price(o: ExploreObject): number | null | undefined;
  boost(u: Understood, o: ExploreObject): [number, string[]];
  sections(o: ExploreObject): string[];
  quality(o: ExploreObject): number;
  /** isOverBudget: mục ở tầng thay thế vì vượt ngân sách. */
  reason(u: Understood, o: ExploreObject, isOverBudget: boolean): string[];
}

const base: Omit<Vertical, 'name'> = {
  mods: null,
  price: (o) => o.cost, // mục nào có chi phí (vd video kèm lộ trình) cũng chịu giới hạn ngân sách
  boost: () => [0, []],
  sections: (o) => [o.kind],
  quality: bayesQuality,
  reason: (_, o) => starsReason(o),
};

export const VERTICALS: readonly Vertical[] = [
  { ...base, name: 'eats' },
  {
    ...base,
    name: 'stays',
    mods: SOFT_BUT_NGON,
    price: (o) => o.priceNight,
    // ponytail: khách sạn TripFlix chưa có điểm review qua listCatalog -> chất lượng theo sao; thêm ratingAvg khi cần
    quality: (o) => (o.rating == null && o.stars ? 0.3 + 0.1 * o.stars : bayesQuality(o)),
    reason: (u, o, isOverBudget) => {
      const why = o.stars && o.rating == null ? [`${o.stars} sao`] : starsReason(o);
      if (o.priceNight) {
        why.push(`~${Math.floor(o.priceNight / 1000)}k/đêm${o.priceSim ? ' (mô phỏng)' : ''}${budgetNote(u, isOverBudget)}`);
      }
      return why;
    },
  },
  { ...base, name: 'sights', mods: SOFT_BUT_NGON },
  {
    ...base,
    name: 'videos',
    sections: (o) => ['video', ...(o.topics?.includes('plan') ? ['plan'] : [])], // video lộ trình hiện cả ở vùng Lộ trình
    quality: (o) => Math.min(1, Math.log10(o.views || 1000) / 6.5),
    reason: (_, o) => (o.views ? [`${o.views.toLocaleString('en-US').replace(/,/g, '.')} lượt xem`] : []),
  },
  {
    ...base,
    name: 'plans',
    quality: (o) => (o.kind === 'post' ? Math.min(1, Math.log10((o.likes || 1) + 1) / 4) : bayesQuality(o)),
    reason: (u, o, isOverBudget) => {
      const why = o.kind === 'plan' ? starsReason(o) : [`♥ ${o.likes ?? 0} · ${o.n ?? 0} bình luận`];
      if (o.cost) why.push(`~${(o.cost / 1e6).toFixed(1)}tr/người${budgetNote(u, isOverBudget)}`);
      return why;
    },
  },
];

/** Điều kiện đã nới để mục lọt vào: chỉ có ở tầng thay thế, không bao giờ ở kết quả chính. */
export type Relax = 'place' | 'budget' | 'terms';

interface Row {
  doc: IndexedDoc;
  vertical: Vertical;
  s: number;
  hit: string[];
  cov: number;
  near: number;
  dist: number | null;
  rank: number;
  /** Rỗng = đạt đủ câu (kết quả chính). */
  relaxed: Relax[];
  /** Từ chính mục không khớp. */
  missing: string[];
  /** Mọi từ của câu mục không khớp (để báo từ bị bỏ). */
  unmatched: string[];
  /** Khớp ít nhất một từ chính, hoặc đúng nơi / đúng ý muốn: đủ liên quan để làm gợi ý thay thế. */
  isRelated: boolean;
  /** Cách hiểu cho ra dòng này (để ghi lý do). */
  u: Understood;
}

type LatLon = { lat: number; lon: number };

/** Ngoài NEAR_KM vẫn lấy tới FAR_KM, nhưng chỉ cho tầng thay thế. */
export const FAR_KM = 150;
/** Từ khớp sai dấu người dùng gõ ('trứng' ~ 'Trung'): còn chừng này trọng số, và không tính là đã khớp. */
const ACCENT_MISS = 0.3;
/** Câu không có nơi, không có ý muốn: gợi ý thay thế phải phủ ít nhất chừng này phần câu (chặn câu ngoài phạm vi). */
const RELATED_COVERAGE = 0.5;

async function searchVertical(
  vt: Vertical,
  u: Understood,
  st: Stats,
  center: LatLon | null,
  user: LatLon | null,
  isBroad: boolean,
): Promise<Map<string, Row[]>> {
  const out = new Map<string, Row[]>();
  const [v, qterms] = await branchTerms(u, st, vt.mods);
  // Câu có từ nhưng nhánh không hiểu từ nào -> không đoán. Lượt mở rộng (isBroad) vẫn lấy theo nơi / ý muốn.
  if (!isBroad && !qterms.length && (u.terms.length || u.subtypes.length)) return out;
  // Từ chính (không bổ nghĩa, có trong dữ liệu): kết quả chính phải khớp ít nhất một. Độ phủ = phần câu được đáp ứng.
  let core = v.terms.filter((t) => !v.soft.includes(t) && !u.unknown.includes(t));
  const nameWords = new Set(u.names.flatMap((n) => n.split(' ')));
  core = [...core.filter((t) => !nameWords.has(t)), ...u.names]; // tên riêng = MỘT từ chính
  for (const p of u.phrases) {
    const w = p.split(' ');
    if (w.every((x) => core.includes(x))) core = [...core.filter((t) => !w.includes(t)), p]; // cụm dính phải khớp cả cụm
  }
  const subs = v.subtypes.map(([p]) => p); // loại cụ thể: ưu tiên mềm; cùng tầm được nửa điểm
  const qtier = new Set(subs.flatMap((p) => (LEX.tier.has(p) ? [LEX.tier.get(p)![0]] : [])));
  const cmap = new Map(v.matched.filter(([, typ]) => typ === 'concept').map(([p, , b]) => [p, b]));
  const softc = v.concepts.filter((c) => LEX.soft.has(c));
  const units = core.length + softc.length + subs.length;

  const coverage = (hit: readonly string[], ot: readonly [string, number] | null): [string[], number, string[]] => {
    const ws = new Set(hit.flatMap((h) => h.split('_').map((x) => x.replace(/^#+/, ''))));
    const phr = new Set(hit.map((h) => h.replace(/_/g, ' ')));
    const member = (c: string) => LEX.membersOf('concept', c).some((m) => phr.has(m));
    const hs = new Set(hit);
    // 'Đồng Khởi' ≠ 'Đồng ... Khởi'
    const adj = (w: string[]) =>
      w.length > 1 ? hs.has(w.join('_')) || w.slice(1).every((b, i) => hs.has(`${w[i]}_${b}`)) : ws.has(w[0]!);
    const isCovered = (t: string) => adj(t.split(' ')) || (cmap.has(t) && member(cmap.get(t)!));
    const missing = core.filter((t) => !isCovered(t));
    const ss = softc.filter(member).length;
    const ts = subs.reduce((n, p) => n + (p.split(' ').every((x) => ws.has(x)) ? 1 : ot && qtier.has(ot[0]) ? 0.5 : 0), 0);
    // Từ bỏ qua = mọi từ của câu (kể cả bổ nghĩa, từ lạ) mà mục không khớp; chỉ để báo, không ảnh hưởng điểm.
    return [missing, units ? (core.length - missing.length + ss + ts) / units : 1, v.terms.filter((t) => !isCovered(t))];
  };

  await st.load([{ ns: NS.docs, key: vt.name }, { ns: NS.len, key: vt.name }, ...qterms.map(([t]) => ({ ns: NS.dfOf(vt.name), key: t }))]);
  const live = st.get(NS.docs, vt.name);
  const avgdl = st.get(NS.len, vt.name) / Math.max(live, 1);
  const idf = (t: string) => {
    const f = st.get(NS.dfOf(vt.name), t);
    return Math.log(1 + (live - f + 0.5) / (f + 0.5));
  };
  const score = (doc: IndexedDoc, terms: readonly QueryTerm[]): [number, string[]] => {
    let s = 0;
    const hit: string[] = [];
    const acc = doc.acc ? new Set(doc.acc) : null;
    for (const [t, w0, a] of terms) {
      const f = Object.hasOwn(doc.tf, t) ? doc.tf[t] : 0;
      if (!f) continue;
      let w = w0;
      let isMatched = true;
      if (a.length && acc) {
        // Gõ 'trứng' mà tài liệu (có dấu) chỉ có 'Trung': giữ chút điểm nhưng không tính là khớp.
        if (a.every((x) => acc.has(x))) w *= 1.5; // đúng dấu người dùng gõ > tài liệu không dấu
        else [w, isMatched] = [w * ACCENT_MISS, false];
      }
      s += (w * idf(t) * f * (K1 + 1)) / (f + K1 * (1 - B + (B * doc.dl) / avgdl));
      if (isMatched) hit.push(t);
    }
    return [s, hit];
  };

  const docs = await st.source.candidates({
    vertical: vt.name,
    isAll: isBroad || !qterms.length,
    terms: qterms.map(([t]) => t),
    names: u.names,
    tiers: [...qtier],
    days: u.days,
    place: u.place,
    center,
    latSpan: FAR_KM / 111,
  });
  for (const doc of docs) {
    const o = doc.obj;
    const relaxed: Relax[] = [];
    let near = 0; // 0 = đúng nơi; > 0 = km tới tâm nơi (gần đó, xếp sau)
    let penalty = 1;
    if (u.place && o.place !== u.place) {
      const d = center ? km(o, center) : null;
      if (d === null || d > FAR_KM) continue; // không biết ở đâu, hoặc quá xa: không phải "gần đó"
      near = d;
      if (d > NEAR_KM) {
        relaxed.push('place');
        penalty *= NEAR_KM / d;
      }
    }
    const price = vt.price(o);
    if (u.budget && price && price > u.budget) {
      relaxed.push('budget'); // kết quả chính không bao giờ vượt ngân sách
      penalty *= u.budget / price;
    }
    let [s, hit] = qterms.length ? score(doc, qterms) : [0, [] as string[]];
    let [b, extra] = vt.boost(u, o);
    // Số ngày cộng điểm ở mọi nhánh có số ngày (lộ trình, video kèm lộ trình): đúng +2, lệch 1 ngày +1. Không phải bộ lọc.
    const dayGap = u.days && o.days ? Math.abs(o.days - u.days) : null;
    if (dayGap !== null && dayGap <= 1) {
      b += 2 - dayGap;
      if (!dayGap) extra = [...extra, `${u.days} ngay`];
    }
    const on = u.names.filter((n) => doc.streets.includes(n)); // 'trần hưng đạo' -> chỗ ở đường đó dù tên không nhắc
    b += 2 * on.length;
    extra = [...extra, ...on.map((n) => n.replace(/ /g, '_'))];
    s += b;
    hit = [...hit, ...extra];
    const ot = doc.tier;
    if (!hit.length && ot && qtier.has(ot[0]) && (!u.intents.length || u.intents.includes(o.kind))) {
      hit = [`~${ot[0]}`]; // gõ 'homestay' -> hostel, nhà nghỉ cùng tầm vẫn được gợi ý (xếp sau)
    }
    const [missing, cov, unmatched] = coverage(hit, ot);
    // Không khớp từ nào, hoặc chỉ khớp từ bổ nghĩa ('ngon'): không phải kết quả chính.
    if ((qterms.length && !hit.length) || (core.length && missing.length === core.length)) relaxed.push('terms');
    const isPlace = Boolean(u.place) && near <= NEAR_KM;
    for (const k of vt.sections(o)) {
      const isRelated = missing.length < core.length || isPlace || u.intents.includes(k) || (!core.length && !u.place && !u.intents.length);
      const dist = user && o.lat != null ? km(o, user) : null;
      if (user) near = dist !== null && dist <= NEAR_KM ? 0 : dist || 1e4; // như nơi: gần người dùng xếp trước
      out.set(k, [...(out.get(k) ?? []), { doc, vertical: vt, s, hit, cov, near, dist, rank: penalty, relaxed, missing, unmatched, isRelated, u }]);
    }
  }
  const isScored = qterms.length > 0 || Boolean(u.days);
  const qw = v.quality ? 0.5 : 0.35; // 'ngon', 'đẹp'... -> chất lượng nặng hơn
  for (const rows of out.values()) {
    const mx = Math.max(...rows.map((r) => r.s)) || 1;
    for (const r of rows) {
      // Liên quan = nửa độ phủ + nửa BM25 (chuẩn hoá trong nhánh). Cùng phủ đủ -> chất lượng quyết định. rank đang giữ hệ số phạt.
      const q = vt.quality(r.doc.obj);
      let rank = isScored ? (1 - qw) * (0.5 * r.cov + (0.5 * r.s) / mx) + qw * q : q;
      if (user) {
        const prox = r.dist !== null ? 1 / (1 + r.dist / USER_KM) : 0;
        rank = (1 - USER_W) * rank + USER_W * prox;
      }
      r.rank *= rank;
    }
  }
  return out;
}

export interface ExploreItem {
  obj: ExploreObject;
  reason: string;
  score: number;
  /** Tên vùng (chỉ có ở mục thay thế). */
  section?: string;
  /** Điều kiện đã nới (chỉ có ở mục thay thế). */
  relaxed?: Relax[];
}

export interface ExploreSection {
  kind: string;
  label: string;
  total: number;
  items: ExploreItem[];
  top: number;
  best: number;
}

/** Kết quả thay thế: vùng câu muốn không có mục nào đạt đủ câu, nên nới điều kiện (chấm điểm mềm) rồi lấy mục gần nhất. */
export interface ExploreFallback {
  /** Các điều kiện đã nới, gộp trên các mục được trả. */
  relaxed: Relax[];
  /** Từ trong câu mà các mục thay thế không khớp (dạng người dùng gõ, có dấu). */
  dropped: string[];
  items: ExploreItem[];
}

export interface ExploreResult {
  query: string;
  understood: Understood;
  sections: ExploreSection[];
  nearUser: boolean;
  fallback: ExploreFallback | null;
  /** @deprecated dùng fallback.items. */
  suggest: ExploreItem[];
  /** @deprecated dùng fallback.dropped. */
  dropped: string[];
}

const round2 = (x: number) => Math.round(x * 100) / 100;

function reasonOf(r: Row): string {
  const why: string[] = [];
  const u = r.u;
  const ws = [...new Set(r.hit.filter((h) => h[0] !== '~').map((h) => h.replace(/_/g, ' ')))].sort((a, b) => b.length - a.length).slice(0, 3);
  if (ws.length) why.push(`Khớp: ${ws.join(', ')}`);
  if (r.hit[0]?.[0] === '~') why.push(`Cùng tầm ${r.hit[0].slice(1)}`);
  if (u.place) why.push(r.near ? `Gần ${u.place} · ${r.near.toFixed(0)} km` : `Ở ${u.place}`);
  if (r.dist !== null) why.push(`Cách bạn ${r.dist.toFixed(1).replace('.', ',')} km`);
  return [...why, ...r.vertical.reason(u, r.doc.obj, r.relaxed.includes('budget'))].join(' · ');
}

const isExact = (r: Row) => r.relaxed.length === 0;
/** Dòng tốt hơn khi gộp các cách hiểu: đạt đủ câu trước, rồi rank. */
const isBetter = (a: Row, b: Row) => (isExact(a) !== isExact(b) ? isExact(a) : a.rank > b.rank);

/** Chạy mọi nhánh cho mọi cách hiểu, gộp theo (vùng, mục): giữ dòng tốt hơn; rank đã nhân trọng số cách hiểu. */
async function collect(
  st: Stats,
  interps: readonly Interpretation[],
  user: LatLon | null,
  isBroad: boolean,
): Promise<Map<string, Map<string, Row>>> {
  const groups = new Map<string, Map<string, Row>>();
  for (const it of interps) {
    const center = it.u.place ? await st.center(it.u.place) : null;
    // Các nhánh độc lập: chạy song song (mỗi nhánh vài lần đọc DB), gộp theo đúng thứ tự VERTICALS.
    const perVertical = await Promise.all(VERTICALS.map((vt) => searchVertical(vt, it.u, st, center, user, isBroad)));
    for (const found of perVertical) {
      for (const [k, rows] of found) {
        const g = groups.get(k) ?? groups.set(k, new Map()).get(k)!;
        for (const r of rows) {
          r.rank *= it.weight;
          const old = g.get(r.doc.id);
          if (!old || isBetter(r, old)) g.set(r.doc.id, r);
        }
      }
    }
  }
  return groups;
}

const byRank = (a: Row, b: Row) => Number(a.near > 0) - Number(b.near > 0) || b.rank - a.rank; // đúng nơi trước

function buildSections(groups: Map<string, Map<string, Row>>, u: Understood, perSection: number, full: ReadonlySet<string> | null): ExploreSection[] {
  const out: ExploreSection[] = SECTIONS.map(([k, label]) => {
    const rows = [...(groups.get(k)?.values() ?? [])].filter(isExact).sort(byRank);
    const n = (full ? full.has(k) : u.intents.includes(k) || !u.intents.length) ? perSection : 3;
    return {
      kind: k,
      label,
      total: rows.length,
      items: rows.slice(0, n).map((r) => ({ obj: r.doc.obj, reason: reasonOf(r), score: round2(r.s) })),
      top: rows.length ? round2(rows[0]!.cov) : 0,
      best: round2(Math.max(0, ...rows.map((r) => r.s))),
    };
  });
  // Vùng câu nhắm tới đứng đầu (theo thứ tự trong câu); còn lại: có kết quả trước, kết quả đầu đáp ứng câu nhiều hơn trước, rỗng cuối.
  const pos = new Map(u.intents.map((k, i) => [k, i]));
  const key = (x: ExploreSection) => [pos.get(x.kind) ?? pos.size, Number(x.total === 0), -x.top, -x.best];
  out.sort((a, b) => {
    const [ka, kb] = [key(a), key(b)];
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i]! - kb[i]!;
    return 0;
  });
  return out;
}

/** Mục thay thế: dòng đã nới điều kiện nhưng vẫn liên quan, ở các vùng câu muốn. */
function buildFallback(groups: Map<string, Map<string, Row>>, kinds: readonly string[], u: Understood, n: number): ExploreFallback | null {
  const label = new Map(SECTIONS);
  const picked = kinds.flatMap((k) =>
    [...(groups.get(k)?.values() ?? [])]
      .filter((r) => !isExact(r) && r.isRelated && (u.place || u.intents.length || r.cov >= RELATED_COVERAGE))
      .sort(byRank)
      .slice(0, n)
      .map((r) => [k, r] as const),
  );
  if (!picked.length) return null;
  const rows = picked.map(([, r]) => r);
  const relaxed = (['place', 'budget', 'terms'] as const).filter((x) => rows.some((r) => r.relaxed.includes(x)));
  const missing = [...new Set(rows.filter((r) => r.relaxed.includes('terms')).flatMap((r) => r.unmatched))];
  return {
    relaxed,
    dropped: missing.map((t) => t.split(' ').map((w) => u.accents[w] ?? w).join(' ')), // 'mua he' -> 'mùa hè'
    items: picked.map(([k, r]) => ({ obj: r.doc.obj, reason: reasonOf(r), score: round2(r.s), section: label.get(k)!, relaxed: r.relaxed })),
  };
}

/**
 * loc = vị trí người dùng (tuỳ chọn). Chỉ dùng khi câu không nói rõ nơi: kết quả gần người dùng được xếp lên.
 * fullKinds = các vùng luôn lấy đủ perSection mục (mặc định: vùng câu nhắm tới), vd tìm bài chỉ cần vùng bài.
 *
 * Mọi điều kiện đều chấm mềm, nhưng kết quả chính (sections) chỉ gồm mục đạt đủ câu: đúng nơi (hoặc trong NEAR_KM), không vượt
 * ngân sách, khớp ít nhất một từ chính. Vùng câu muốn không có mục nào như vậy -> fallback: mục gần nhất sau khi nới (khác nơi tới
 * FAR_KM, vượt ngân sách, thiếu từ), kèm điều kiện đã nới để FE nói "Kết quả thay thế cho ...". Câu không liên quan gì thì cả hai rỗng.
 */
export async function searchExplore(
  source: ExploreSource,
  q: string,
  options: { perSection?: number; loc?: LatLon | null; fullKinds?: readonly string[] } = {},
): Promise<ExploreResult> {
  const full = options.fullKinds ? new Set(options.fullKinds) : null;
  const perSection = options.perSection ?? 6;
  const st = new Stats(source);
  const interps = await understand(q, st);
  const u = interps[0]!.u;
  const user = options.loc && !u.place ? options.loc : null;
  const groups = await collect(st, interps, user, false);
  const sections = buildSections(groups, u, perSection, full);
  const kinds = u.intents.length ? u.intents : full ? [...full] : SECTIONS.map(([k]) => k);
  let fallback: ExploreFallback | null = null;
  if (!sections.some((s) => kinds.includes(s.kind) && s.total)) {
    const n = u.intents.length || full ? perSection : 2;
    fallback = buildFallback(groups, kinds, u, n);
    // Chưa có gì để thay thế mà câu có nơi (hoặc gần tôi): mở rộng ứng viên ra mọi mục quanh nơi, không cần chứa từ.
    if (!fallback && (user || interps.some((it) => it.u.place))) fallback = buildFallback(await collect(st, interps, user, true), kinds, u, n);
  }
  return { query: q, understood: u, sections, nearUser: Boolean(user), fallback, suggest: fallback?.items ?? [], dropped: fallback?.dropped ?? [] };
}
