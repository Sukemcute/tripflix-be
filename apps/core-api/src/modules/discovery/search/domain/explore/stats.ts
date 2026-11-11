// Thống kê chung cho hiểu câu: df, độ dính cụm (NPMI), từ điển tên riêng, tâm toạ độ mỗi nơi.
// Đọc lười từ ExploreSource theo khoá cần cho câu đang tìm; đã đọc thì giữ trong request.
import { LEX } from './lexicon.js';
import type { ExploreSource } from './types.js';

export const NAME_MIN = 2; // tên đường gặp ở 1 object có thể là gõ sai -> chưa tin
export const CHAIN_MIN = 3;
export const CHAIN_PLACES = 2;
export const CHAIN_ALONE = 0.35;
const PHRASE_MIN = 3; // cụm gặp < 3 lần: chưa đủ tin, coi như không dính
const PHRASE_MAXN = 3;

/** Tên namespace trong bảng đếm. */
export const NS = {
  df: 'df',
  dfOf: (vertical: string) => `df.${vertical}`,
  docs: 'docs',
  len: 'len',
  ngram: 'ng',
  ngramTotal: 'ngn',
  street: 'street',
  brand: 'brand',
  brandPlaces: 'bplaces',
  titleGram: 'tgram',
  centerLat: 'clat',
  centerLon: 'clon',
} as const;

/** Namespace bộ đếm chứa cụm nhiều từ có nghĩa (tên đường, chuỗi cửa hàng, cụm trong tiêu đề): đích của sửa lỗi bỏ khoảng trắng. */
export const PHRASE_NS: readonly string[] = [NS.street, NS.brand, NS.titleGram];

const grams = (seq: readonly string[], from: number, to: number): string[] => {
  const out: string[] = [];
  for (let k = from; k <= to; k++) for (let i = 0; i + k <= seq.length; i++) out.push(seq.slice(i, i + k).join(' '));
  return out;
};

export class Stats {
  private readonly values = new Map<string, number>();
  private readonly pools = new Map<string, string[]>();

  constructor(readonly source: ExploreSource) {}

  private static id(ns: string, key: string) {
    return `${ns}\u0000${key}`;
  }

  /** Khoá đang được đọc bởi một load khác (các nhánh chạy song song): chờ nó thay vì đọc lại hay đọc nhầm 0. */
  private readonly pending = new Map<string, Promise<void>>();

  async load(keys: ReadonlyArray<{ ns: string; key: string }>): Promise<void> {
    const missing = new Map<string, { ns: string; key: string }>();
    const waits = new Set<Promise<void>>();
    for (const k of keys) {
      const id = Stats.id(k.ns, k.key);
      const p = this.pending.get(id);
      if (p) waits.add(p);
      else if (!this.values.has(id)) missing.set(id, k);
    }
    if (missing.size) {
      const job = this.source.counts([...missing.values()]).then((rows) => {
        for (const id of missing.keys()) this.values.set(id, 0);
        for (const row of rows) this.values.set(Stats.id(row.ns, row.key), row.n);
      });
      for (const id of missing.keys()) this.pending.set(id, job);
      waits.add(job);
      void job.finally(() => {
        for (const id of missing.keys()) this.pending.delete(id);
      }).catch(() => undefined);
    }
    await Promise.all(waits);
  }

  /** Đọc một bộ đếm đã load; chưa load coi như 0. */
  get(ns: string, key: string): number {
    return this.values.get(Stats.id(ns, key)) ?? 0;
  }

  df(w: string): number {
    return this.get(NS.df, w);
  }

  /** Khoá cần cho tên riêng (2-4 âm tiết) và độ dính cụm (1-3 âm tiết) của chuỗi từ. */
  async loadSeq(seq: readonly string[]): Promise<void> {
    const names = grams(seq, 2, 4).flatMap((g) => [NS.street, NS.brand, NS.brandPlaces, NS.titleGram].map((ns) => ({ ns, key: g })));
    const ngrams = grams(seq, 1, PHRASE_MAXN).map((g) => ({ ns: NS.ngram, key: g }));
    const totals = ['1', '2', '3'].map((key) => ({ ns: NS.ngramTotal, key }));
    await this.load([...names, ...ngrams, ...totals]);
  }

  /** Ứng viên sửa lỗi gõ cho w: từ lexicon + từ đơn của chỉ mục, cùng chữ cái đầu, lệch độ dài <= 2. */
  async loadTypoPool(w: string): Promise<void> {
    const id = `${w[0]}|${w.length}`;
    if (this.pools.has(id)) return;
    const rows = await this.source.typoPool(w[0]!, w.length - 2, w.length + 2);
    for (const r of rows) this.values.set(Stats.id(NS.df, r.term), r.df);
    const vocab = [...LEX.vocab].filter((t) => t[0] === w[0] && Math.abs(t.length - w.length) <= 2);
    // Từ lexicon không có trong chỉ mục: df = 0 (pool đã phủ mọi từ chỉ mục cùng chữ đầu, cùng khoảng độ dài).
    for (const t of vocab) if (!this.values.has(Stats.id(NS.df, t))) this.values.set(Stats.id(NS.df, t), 0);
    this.pools.set(id, [...new Set([...vocab, ...rows.map((r) => r.term)])]);
  }

  typoCandidates(w: string): string[] {
    return this.pools.get(`${w[0]}|${w.length}`) ?? [];
  }

  private readonly phrasePools = new Map<string, string[]>();

  /** Cụm nhiều từ cùng chữ đầu với w, độ dài (bỏ khoảng trắng) lệch <= 2: tên nhập tay + cụm trong chỉ mục. */
  async loadPhrasePool(w: string): Promise<void> {
    const id = `${w[0]}|${w.length}`;
    if (this.phrasePools.has(id)) return;
    const [minLen, maxLen] = [w.length - 2, w.length + 2];
    const rows = await this.source.phrasePool(w[0]!, minLen, maxLen);
    const names = [...LEX.names.keys()].filter((n) => {
      const len = n.split(' ').join('').length;
      return n.includes(' ') && n[0] === w[0] && len >= minLen && len <= maxLen;
    });
    this.phrasePools.set(id, [...new Set([...names, ...rows])]);
  }

  phraseCandidates(w: string): string[] {
    return this.phrasePools.get(`${w[0]}|${w.length}`) ?? [];
  }

  isChain(b: string): boolean {
    const c = this.get(NS.brand, b);
    return c >= CHAIN_MIN && c >= CHAIN_ALONE * this.get(NS.titleGram, b) && this.get(NS.brandPlaces, b) >= CHAIN_PLACES;
  }

  /** Từ điển tên riêng = tên nhập tay + tên đường/khu trong địa chỉ của >= NAME_MIN object + chuỗi cửa hàng. */
  isName(ph: string): boolean {
    return LEX.names.has(ph) || this.get(NS.street, ph) >= NAME_MIN || this.isChain(ph);
  }

  private p(g: string): number {
    const total = this.get(NS.ngramTotal, String(g.split(' ').length));
    return total ? this.get(NS.ngram, g) / total : 0;
  }

  /** Độ dính giữa hai nửa a | b của cụm 'a b'. 1 = luôn đi cùng nhau, 0 = ngẫu nhiên, < 0 = tránh nhau. */
  npmi(a: string, b: string): number {
    const ab = `${a} ${b}`;
    if (this.get(NS.ngram, ab) < PHRASE_MIN) return 0;
    const pab = this.p(ab);
    return pab < 1 ? Math.log(pab / (this.p(a) * this.p(b))) / -Math.log(pab) : 1;
  }

  /** Độ dính của cả cụm = mắt xích yếu nhất. */
  stick(ws: readonly string[]): number {
    if (ws.length < 2) return 0;
    let min = Infinity;
    for (let i = 1; i < ws.length; i++) min = Math.min(min, this.npmi(ws.slice(0, i).join(' '), ws.slice(i).join(' ')));
    return min;
  }

  /** Tách thành cụm: tham lam, ưu tiên cụm dài nhất có độ dính >= t. 'com tam long xuyen' -> [com tam][long xuyen]. */
  segment(ws: readonly string[], t = 0.25): string[][] {
    const out: string[][] = [];
    let i = 0;
    while (i < ws.length) {
      for (let k = Math.min(PHRASE_MAXN, ws.length - i); k > 0; k--) {
        if (k === 1 || this.stick(ws.slice(i, i + k)) >= t) {
          out.push(ws.slice(i, i + k));
          i += k;
          break;
        }
      }
    }
    return out;
  }

  async center(place: string): Promise<{ lat: number; lon: number } | null> {
    await this.load([
      { ns: NS.centerLat, key: place },
      { ns: NS.centerLon, key: place },
    ]);
    const has = this.values.get(Stats.id(NS.centerLat, place));
    return has ? { lat: this.get(NS.centerLat, place), lon: this.get(NS.centerLon, place) } : null;
  }
}
