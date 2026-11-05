// Tìm khám phá: HIỂU CÂU một lần -> mỗi NHÁNH lấy ứng viên rồi chấm BM25, độ phủ, luật dấu, chất lượng, độ gần -> GỘP theo vùng.
// Port từ experiments/natural-search/search/engine.py + verticals/*.py; giữ nguyên công thức để so được với bộ câu thử.
import { LEX } from './lexicon.js';
import { blendedTerms, understand, type QueryTerm, type Understood } from './query.js';
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
  reason(u: Understood, o: ExploreObject): string[];
}

const base: Omit<Vertical, 'name'> = {
  mods: null,
  price: () => null,
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
    reason: (u, o) => {
      const why = o.stars && o.rating == null ? [`${o.stars} sao`] : starsReason(o);
      if (o.priceNight) {
        why.push(`~${Math.floor(o.priceNight / 1000)}k/đêm${o.priceSim ? ' (mô phỏng)' : ''}${u.budget ? ' · trong ngân sách' : ''}`);
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
    price: (o) => o.cost,
    boost: (u, o) => (u.days && o.days === u.days ? [2, [`${u.days} ngay`]] : [0, []]),
    quality: (o) => (o.kind === 'post' ? Math.min(1, Math.log10((o.likes || 1) + 1) / 4) : bayesQuality(o)),
    reason: (u, o) => {
      const why = o.kind === 'plan' ? starsReason(o) : [`♥ ${o.likes ?? 0} · ${o.n ?? 0} bình luận`];
      if (o.cost) why.push(`~${(o.cost / 1e6).toFixed(1)}tr/người${u.budget ? ' · trong ngân sách' : ''}`);
      return why;
    },
  },
];

interface Row {
  doc: IndexedDoc;
  vertical: Vertical;
  s: number;
  hit: string[];
  cov: number;
  near: number;
  dist: number | null;
  rank: number;
}

type LatLon = { lat: number; lon: number };

async function searchVertical(
  vt: Vertical,
  u: Understood,
  u0: Understood | null,
  st: Stats,
  center: LatLon | null,
  user: LatLon | null,
): Promise<Map<string, Row[]>> {
  const out = new Map<string, Row[]>();
  const [v, qterms] = await blendedTerms(u, u0, st, vt.mods);
  if (!qterms.length && (u.terms.length || u.subtypes.length)) return out; // câu có từ nhưng nhánh không hiểu từ nào -> không đoán
  // Từ chính (không bổ nghĩa, có trong dữ liệu): object phải khớp ít nhất một. Độ phủ = phần câu được đáp ứng.
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

  const coverage = (hit: readonly string[], ot: readonly [string, number] | null): [number, number] => {
    const ws = new Set(hit.flatMap((h) => h.split('_').map((x) => x.replace(/^#+/, ''))));
    const phr = new Set(hit.map((h) => h.replace(/_/g, ' ')));
    const member = (c: string) => LEX.membersOf('concept', c).some((m) => phr.has(m));
    const hs = new Set(hit);
    // 'Đồng Khởi' ≠ 'Đồng ... Khởi'
    const adj = (w: string[]) =>
      w.length > 1 ? hs.has(w.join('_')) || w.slice(1).every((b, i) => hs.has(`${w[i]}_${b}`)) : ws.has(w[0]!);
    const cs = core.filter((t) => adj(t.split(' ')) || (cmap.has(t) && member(cmap.get(t)!))).length;
    const ss = softc.filter(member).length;
    const ts = subs.reduce((n, p) => n + (p.split(' ').every((x) => ws.has(x)) ? 1 : ot && qtier.has(ot[0]) ? 0.5 : 0), 0);
    return [cs, units ? (cs + ss + ts) / units : 1];
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
      if (a.length && acc) {
        if (!a.every((x) => acc.has(x))) continue; // gõ 'trứng' mà tài liệu (có dấu) chỉ có 'Trung'
        w *= 1.5; // đúng dấu người dùng gõ > tài liệu không dấu
      }
      s += (w * idf(t) * f * (K1 + 1)) / (f + K1 * (1 - B + (B * doc.dl) / avgdl));
      hit.push(t);
    }
    return [s, hit];
  };

  const docs = await st.source.candidates({
    vertical: vt.name,
    isAll: !qterms.length,
    terms: qterms.map(([t]) => t),
    names: u.names,
    tiers: [...qtier],
    days: u.days,
    place: u.place,
    center,
    latSpan: NEAR_KM / 111,
  });
  for (const doc of docs) {
    const o = doc.obj;
    let near = 0; // 0 = đúng nơi; > 0 = km tới tâm nơi (gần đó, xếp sau)
    if (u.place && o.place !== u.place) {
      if (!center || o.lat == null || Math.abs(o.lat - center.lat) > NEAR_KM / 111) continue;
      const d = km(o, center);
      if (d === null || d > NEAR_KM) continue;
      near = d;
    }
    const price = vt.price(o);
    if (u.budget && price && price > u.budget) continue; // không bao giờ vượt ngân sách
    let [s, hit] = qterms.length ? score(doc, qterms) : [0, [] as string[]];
    let [b, extra] = vt.boost(u, o);
    const on = u.names.filter((n) => doc.streets.includes(n)); // 'trần hưng đạo' -> chỗ ở đường đó dù tên không nhắc
    b += 2 * on.length;
    extra = [...extra, ...on.map((n) => n.replace(/ /g, '_'))];
    s += b;
    hit = [...hit, ...extra];
    const ot = doc.tier;
    if (!hit.length && ot && qtier.has(ot[0]) && (!u.intents.length || u.intents.includes(o.kind))) {
      hit = [`~${ot[0]}`]; // gõ 'homestay' -> hostel, nhà nghỉ cùng tầm vẫn được gợi ý (xếp sau)
    }
    if (qterms.length && !hit.length) continue; // không hiện kết quả không liên quan
    const [cs, cov] = coverage(hit, ot);
    if (core.length && !cs) continue; // chỉ khớp từ bổ nghĩa ('ngon') -> không liên quan
    for (const k of vt.sections(o)) {
      const dist = user && o.lat != null ? km(o, user) : null;
      if (user) near = dist !== null && dist <= NEAR_KM ? 0 : dist || 1e4; // như nơi: gần người dùng xếp trước
      out.set(k, [...(out.get(k) ?? []), { doc, vertical: vt, s, hit, cov, near, dist, rank: 0 }]);
    }
  }
  const isScored = qterms.length > 0 || Boolean(u.days);
  const qw = v.quality ? 0.5 : 0.35; // 'ngon', 'đẹp'... -> chất lượng nặng hơn
  for (const rows of out.values()) {
    const mx = Math.max(...rows.map((r) => r.s)) || 1;
    for (const r of rows) {
      // Liên quan = nửa độ phủ + nửa BM25 (chuẩn hoá trong nhánh). Cùng phủ đủ -> chất lượng quyết định.
      const q = vt.quality(r.doc.obj);
      r.rank = isScored ? (1 - qw) * (0.5 * r.cov + (0.5 * r.s) / mx) + qw * q : q;
      if (user) {
        const prox = r.dist !== null ? 1 / (1 + r.dist / USER_KM) : 0;
        r.rank = (1 - USER_W) * r.rank + USER_W * prox;
      }
    }
  }
  return out;
}

export interface ExploreItem {
  obj: ExploreObject;
  reason: string;
  score: number;
  /** Tên vùng (chỉ có ở mục gợi ý khác). */
  section?: string;
}

export interface ExploreSection {
  kind: string;
  label: string;
  total: number;
  items: ExploreItem[];
  top: number;
  best: number;
}

export interface ExploreResult {
  query: string;
  understood: Understood;
  sections: ExploreSection[];
  nearUser: boolean;
  suggest: ExploreItem[];
  dropped: string[];
}

const round2 = (x: number) => Math.round(x * 100) / 100;

function reasonOf(r: Row, u: Understood): string {
  const why: string[] = [];
  const ws = [...new Set(r.hit.filter((h) => h[0] !== '~').map((h) => h.replace(/_/g, ' ')))].sort((a, b) => b.length - a.length).slice(0, 3);
  if (ws.length) why.push(`Khớp: ${ws.join(', ')}`);
  if (r.hit[0]?.[0] === '~') why.push(`Cùng tầm ${r.hit[0].slice(1)}`);
  if (u.place) why.push(r.near ? `Gần ${u.place} · ${r.near.toFixed(0)} km` : `Ở ${u.place}`);
  if (r.dist !== null) why.push(`Cách bạn ${r.dist.toFixed(1).replace('.', ',')} km`);
  return [...why, ...r.vertical.reason(u, r.doc.obj)].join(' · ');
}

async function searchSections(
  st: Stats,
  q: string,
  u: Understood,
  u0: Understood | null,
  perSection: number,
  user: LatLon | null,
): Promise<{ query: string; understood: Understood; sections: ExploreSection[] }> {
  const center = u.place ? await st.center(u.place) : null;
  const groups = new Map<string, Row[]>();
  // Các nhánh độc lập: chạy song song (mỗi nhánh vài lần đọc DB), gộp theo đúng thứ tự VERTICALS.
  const perVertical = await Promise.all(VERTICALS.map((vt) => searchVertical(vt, u, u0, st, center, user)));
  for (const found of perVertical) {
    for (const [k, rows] of found) groups.set(k, [...(groups.get(k) ?? []), ...rows]);
  }
  const out: ExploreSection[] = SECTIONS.map(([k, label]) => {
    const rows = [...(groups.get(k) ?? [])].sort((a, b) => Number(a.near > 0) - Number(b.near > 0) || b.rank - a.rank); // đúng nơi trước
    const n = u.intents.includes(k) || !u.intents.length ? perSection : 3;
    return {
      kind: k,
      label,
      total: rows.length,
      items: rows.slice(0, n).map((r) => ({ obj: r.doc.obj, reason: reasonOf(r, u), score: round2(r.s) })),
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
  return { query: q, understood: u, sections: out };
}

/** loc = vị trí người dùng (tuỳ chọn). Chỉ dùng khi câu không nói rõ nơi: kết quả gần người dùng được xếp lên. */
export async function searchExplore(
  source: ExploreSource,
  q: string,
  options: { perSection?: number; loc?: LatLon | null } = {},
): Promise<ExploreResult> {
  const perSection = options.perSection ?? 6;
  const st = new Stats(source);
  const [u, u0] = await understand(q, st);
  const user = options.loc && !u.place ? options.loc : null;
  const r = await searchSections(st, q, u, u0, perSection, user);
  // Vùng người dùng muốn không có gì đáp ứng đủ câu -> giữ "không có kết quả phù hợp", thêm "Các gợi ý khác" ở cuối:
  // tìm lại chỉ theo nơi + ý muốn + ngân sách (bỏ mọi từ), xếp theo chất lượng. Câu không có nơi, không có ý muốn thì không đoán.
  const kinds = u.intents.length ? u.intents : SECTIONS.map(([k]) => k);
  let suggest: ExploreItem[] = [];
  let dropped: string[] = [];
  if (u.terms.length && (u.place || u.intents.length) && !r.sections.some((s) => kinds.includes(s.kind) && s.total)) {
    const loose: Understood = {
      ...u, terms: [], seq: [], phrases: [], names: [], soft: [], concepts: [],
      matched: u.matched.filter(([, typ]) => typ !== 'concept'),
    };
    const n = u.intents.length ? perSection : 2;
    const again = await searchSections(st, q, loose, null, perSection, user);
    suggest = again.sections.filter((s) => kinds.includes(s.kind)).flatMap((s) => s.items.slice(0, n).map((i) => ({ ...i, section: s.label })));
    dropped = u.terms.map((t) => t.split(' ').map((w) => u.accents[w] ?? w).join(' ')); // 'mua he' -> 'mùa hè'
  }
  return { ...r, nearUser: Boolean(user), suggest, dropped };
}
