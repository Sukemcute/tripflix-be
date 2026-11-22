// Bộ đo lỗi gõ sinh từ dữ liệu: lấy tên thật (nơi, khách sạn, đường) rồi làm hỏng ngẫu nhiên có seed cố định.
// Đo recall (câu hỏng vẫn ra đúng thứ) và tỉ lệ sửa nhầm (câu đúng bị đổi). Dùng chung cho test CI và bench đầy đủ.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hotelToObject, postToObject } from '../application/explore.use-cases.js';
import type { ExploreHotel, ExplorePost } from '../application/ports.js';
import { buildIndex } from '../domain/explore/build.js';
import { LEX } from '../domain/explore/lexicon.js';
import { MemoryExploreSource } from '../domain/explore/memory-source.js';
import { searchExplore, type ExploreResult } from '../domain/explore/rank.js';
import { fold, streetsOf, words } from '../domain/explore/text.js';
import type { ExploreObject, ExploreSource } from '../domain/explore/types.js';

export type CorruptOp = 'drop1' | 'drop2' | 'dropFirst' | 'insert' | 'replace' | 'swap' | 'join' | 'split';

/** Bộ sinh số ngẫu nhiên có seed (mulberry32): cùng seed ra cùng bộ câu. */
export function rngOf(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Chuỗi đã bỏ dấu chỉ có [a-z0-9 ], nên tách theo từng ký tự bằng split('') là đủ.
const LETTERS = 'abcdeghiklmnopqrstuvxy'.split('');
const pick = <T>(xs: readonly T[], r: () => number): T => xs[Math.floor(r() * xs.length)]!;

/** Vị trí các ký tự chữ (không phải khoảng trắng) trong s. */
const letterPos = (s: string) => s.split('').flatMap((c, i) => (c === ' ' ? [] : [i]));
const removeAt = (s: string, i: number) => s.slice(0, i) + s.slice(i + 1);

/** Làm hỏng chuỗi đã bỏ dấu theo một kiểu. Trả null nếu kiểu đó không áp được (vd 'join' với tên một từ). */
export function corrupt(s: string, op: CorruptOp, r: () => number): string | null {
  const pos = letterPos(s);
  switch (op) {
    case 'drop1':
      return pos.length > 3 ? removeAt(s, pick(pos, r)) : null;
    case 'drop2': {
      if (pos.length < 6) return null;
      const [i, j] = [pick(pos, r), pick(pos, r)].sort((a, b) => b - a);
      return i === j ? null : removeAt(removeAt(s, i!), j!);
    }
    case 'dropFirst': {
      // Bỏ chữ cái đầu của một âm tiết: lỗi mà bộ sửa theo "cùng chữ đầu" không bắt được.
      const starts = s.split('').flatMap((c, i) => (c !== ' ' && (i === 0 || s[i - 1] === ' ') && s.indexOf(' ', i) - i !== 1 ? [i] : []));
      return pos.length > 3 && starts.length ? removeAt(s, pick(starts, r)) : null;
    }
    case 'insert': {
      const i = pick(pos, r);
      return s.slice(0, i) + pick(LETTERS, r) + s.slice(i);
    }
    case 'replace': {
      const i = pick(pos, r);
      const c = pick(LETTERS.filter((x) => x !== s[i]), r);
      return s.slice(0, i) + c + s.slice(i + 1);
    }
    case 'swap': {
      const ok = pos.filter((i) => s[i + 1] && s[i + 1] !== ' ' && s[i] !== s[i + 1]);
      if (!ok.length) return null;
      const i = pick(ok, r);
      return s.slice(0, i) + s[i + 1] + s[i] + s.slice(i + 2);
    }
    case 'join':
      return s.includes(' ') ? s.split(' ').join('') : null;
    case 'split': {
      const w = words(s);
      const long = w.map((x, i) => [x, i] as const).filter(([x]) => x.length >= 5);
      if (!long.length) return null;
      const [x, i] = pick(long, r);
      const k = 2 + Math.floor(r() * (x.length - 3));
      w[i] = `${x.slice(0, k)} ${x.slice(k)}`;
      return w.join(' ');
    }
  }
}

export interface BenchCase {
  /** Loại nguồn: tên nơi, tên khách sạn, tên đường. */
  source: 'place' | 'hotel' | 'street';
  op: CorruptOp | 'clean';
  q: string;
  /** Tên gốc (đã bỏ dấu). */
  original: string;
  /** Đáp án: nơi (place) hoặc các id chấp nhận được (hotel, street). */
  place?: string;
  ids?: string[];
}

/** Các câu hỏng (và câu gốc 'clean') sinh từ dữ liệu. Bỏ biến thể trùng một từ / cụm có thật: khi đó không còn là lỗi gõ. */
export function buildCases(
  objs: readonly ExploreObject[],
  options: { seed?: number; perName?: number; ops?: readonly CorruptOp[]; maxHotels?: number; maxStreets?: number; sources?: ReadonlyArray<BenchCase['source']> } = {},
): BenchCase[] {
  const r = rngOf(options.seed ?? 13);
  const ops = options.ops ?? ['drop1', 'drop2', 'dropFirst', 'insert', 'replace', 'swap', 'join', 'split'];
  const perName = options.perName ?? 2;
  const vocab = new Set(objs.flatMap((o) => words(fold(`${o.title} ${o.addr ?? ''} ${o.place ?? ''}`))));
  for (const k of LEX.phrase.keys()) for (const w of k.split(' ')) vocab.add(w);
  const isReal = (q: string, original: string) => q === original || words(q).every((w) => vocab.has(w)) && !original.includes(q);

  const named: Array<Omit<BenchCase, 'op' | 'q'>> = [];
  const places = new Set(objs.map((o) => o.place).filter(Boolean));
  for (const [term, hits] of LEX.phrase) {
    const place = hits.find(([t]) => t === 'place')?.[1];
    // Bí danh ngắn ('hn', 'dl') là viết tắt, không phải tên để gõ sai.
    if (place && places.has(place) && term.length >= 5) named.push({ source: 'place', original: term, place });
  }
  const hotels = objs.filter((o) => o.kind === 'stay');
  for (const o of hotels.filter((_, i) => i % Math.max(1, Math.floor(hotels.length / (options.maxHotels ?? 60))) === 0)) {
    named.push({ source: 'hotel', original: words(fold(o.title)).join(' '), ids: [o.id] });
  }
  const byStreet = new Map<string, string[]>();
  for (const o of hotels) for (const s of streetsOf(o)) byStreet.set(s, [...(byStreet.get(s) ?? []), o.id]);
  for (const [s, ids] of [...byStreet].filter(([, ids]) => ids.length >= 2).slice(0, options.maxStreets ?? 30)) {
    named.push({ source: 'street', original: s, ids });
  }

  const out: BenchCase[] = [];
  for (const n of named.filter((x) => !options.sources || options.sources.includes(x.source))) {
    out.push({ ...n, op: 'clean', q: n.original });
    for (const op of ops) {
      for (let k = 0; k < perName; k++) {
        const q = corrupt(n.original, op, r);
        if (q && !isReal(q, n.original) && !out.some((c) => c.q === q && c.original === n.original)) out.push({ ...n, op, q });
      }
    }
  }
  return out;
}

/** Kết quả một câu: đúng ở tầng chính (sections) hay chỉ ở tầng thay thế (suggest/fallback). */
export interface CaseScore {
  hitMain: boolean;
  hitAny: boolean;
  isFixed: boolean;
}

const K = 6;

export function scoreCase(c: BenchCase, r: ExploreResult): CaseScore {
  const stay = r.sections.find((s) => s.kind === 'stay');
  const main = stay?.items.slice(0, K).map((i) => i.obj) ?? [];
  const extra = r.suggest.slice(0, K).map((i) => i.obj);
  const ok = (os: readonly ExploreObject[], viaPlace: boolean) =>
    c.place ? (viaPlace && r.understood.place === c.place) || (os.length > 0 && os[0]!.place === c.place) : os.some((o) => c.ids!.includes(o.id));
  return {
    hitMain: ok(main, true),
    hitAny: ok(main, true) || ok(extra, false),
    isFixed: Object.keys(r.understood.fixed).length > 0,
  };
}

export interface BenchRow {
  group: string;
  n: number;
  recallMain: number;
  recallAny: number;
  fixedRate: number;
}

export async function runBench(source: ExploreSource, cases: readonly BenchCase[]): Promise<BenchRow[]> {
  const groups = new Map<string, CaseScore[]>();
  for (const c of cases) {
    const s = scoreCase(c, await searchExplore(source, c.q));
    for (const g of [`${c.source}/${c.op}`, `*/${c.op}`, c.op === 'clean' ? '*/clean' : '*/typo']) {
      groups.set(g, [...(groups.get(g) ?? []), s]);
    }
  }
  const pct = (xs: CaseScore[], f: (s: CaseScore) => boolean) => Math.round((1000 * xs.filter(f).length) / xs.length) / 10;
  return [...groups]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([group, xs]) => ({
      group,
      n: xs.length,
      recallMain: pct(xs, (s) => s.hitMain),
      recallAny: pct(xs, (s) => s.hitAny),
      fixedRate: pct(xs, (s) => s.isFixed),
    }));
}

/** Câu ngoài phạm vi hoặc bẫy (bộ TF13): tỉ lệ câu có kết quả ở tầng chính (càng thấp càng tốt). */
export async function outOfScopeRate(source: ExploreSource, qs: readonly string[]): Promise<number> {
  let n = 0;
  for (const q of qs) if ((await searchExplore(source, q)).sections.some((s) => s.total > 0)) n++;
  return Math.round((1000 * n) / Math.max(1, qs.length)) / 10;
}

const SEED_PATH = join(import.meta.dirname, '../../../commerce/db/seed/catalog.json');

interface SeedHotel {
  id: string;
  name: string;
  provinceSlug: string;
  provinceName: string;
  city: string | null;
  stars: number | null;
  brand: string | null;
  style: string | null;
  basePrice: number | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
}

/** Khách sạn seed của commerce (chỉ đọc file), qua đúng hàm map của discovery. limit: lấy đều để giả dữ liệu ít (cold start). */
export function seedHotels(limit?: number): ExploreObject[] {
  const all = (JSON.parse(readFileSync(SEED_PATH, 'utf8')) as { hotels: SeedHotel[] }).hotels;
  const step = limit ? Math.max(1, Math.floor(all.length / limit)) : 1;
  return all
    .filter((_, i) => i % step === 0)
    .slice(0, limit ?? all.length)
    .map((h) =>
      hotelToObject({
        id: h.id,
        name: h.name,
        province: { slug: h.provinceSlug, name: h.provinceName },
        city: h.city,
        stars: h.stars,
        brand: h.brand,
        style: h.style,
        thumbnail: null,
        priceFrom: h.basePrice,
        address: h.address,
        location: h.lat != null && h.lng != null ? { lat: h.lat, lng: h.lng } : null,
      } satisfies ExploreHotel),
    );
}

export const sourceOf = (objs: readonly ExploreObject[]) => new MemoryExploreSource(buildIndex(objs));

const POSTS_PATH = join(import.meta.dirname, '../../../content/db/seed/posts-seed.json');

/** Bài seed của content (chỉ đọc file), qua đúng hàm map của discovery. */
export function seedPosts(): ExploreObject[] {
  const { posts } = JSON.parse(readFileSync(POSTS_PATH, 'utf8')) as { posts: Array<ExplorePost & { visibility: string; status: string }> };
  return posts.filter((p) => p.status === 'published' && p.visibility === 'public').map(postToObject);
}

// ---------------- Cặp câu khác thứ tự chữ: '3 ngày ở X' (chuyến 3 ngày) / 'ngày 3 ở X' (ngày thứ 3, vlog).
// KHÔNG cùng ý, nên độ trùng chỉ để theo dõi; thứ tự đúng được kiểm bằng dữ liệu tự tạo ở typo-regression.spec.ts.

const POST_SECTIONS = new Set(['plan', 'video', 'post']);
const topIds = (r: ExploreResult, k = 6) =>
  new Set(r.sections.filter((s) => POST_SECTIONS.has(s.kind)).flatMap((s) => s.items.slice(0, k).map((i) => i.obj.id)));

/** Mẫu cặp: [chuyến N ngày, ngày thứ N]. Lấy cả cách viết không dấu. */
const DAY_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['{n} ngày ở {p}', 'ngày {n} ở {p}'],
  ['{p} {n} ngày', '{p} ngày {n}'],
  ['lịch trình {n} ngày {p}', 'lịch trình ngày {n} {p}'],
  ['{n} ngay o {p}', 'ngay {n} o {p}'],
];

export interface DayPairScore {
  pairs: number;
  /** Độ trùng (Jaccard) top-6 bài/lộ trình/video giữa hai câu, trung bình, %. Chỉ để theo dõi: dữ liệu có vlog 'ngày N' thì phải thấp hơn 100. */
  overlap: number;
  /** Câu 'N ngày' (chuyến N ngày): lộ trình/video đầu tiên có đúng N ngày, %. */
  top1Days: number;
}

/** Cặp câu cho mọi nơi có bài có số ngày, n = các số ngày có trong dữ liệu của nơi đó. */
export async function dayPairBench(source: ExploreSource, objs: readonly ExploreObject[]): Promise<DayPairScore> {
  const byPlace = new Map<string, Set<number>>();
  for (const o of objs) if (o.place && o.days && POST_SECTIONS.has(o.kind)) byPlace.set(o.place, (byPlace.get(o.place) ?? new Set()).add(o.days));
  let [pairs, overlap, hits, asked] = [0, 0, 0, 0];
  for (const [place, ns] of byPlace) {
    for (const n of ns) {
      for (const [a, b] of DAY_PAIRS) {
        const fill = (t: string) => t.replace('{n}', String(n)).replace('{p}', t.includes('ngay o') ? fold(place).trim() : place.toLowerCase());
        const [ra, rb] = [await searchExplore(source, fill(a)), await searchExplore(source, fill(b))];
        const [ia, ib] = [topIds(ra), topIds(rb)];
        const union = new Set([...ia, ...ib]);
        overlap += union.size ? [...ia].filter((x) => ib.has(x)).length / union.size : 1;
        pairs++;
        const first = ra.sections.filter((s) => s.kind === 'plan' || s.kind === 'video').flatMap((s) => s.items)[0];
        asked++;
        if (first?.obj.days === n) hits++;
      }
    }
  }
  const pct = (x: number, n: number) => Math.round((1000 * x) / Math.max(1, n)) / 10;
  return { pairs, overlap: pct(overlap, pairs), top1Days: pct(hits, asked) };
}
