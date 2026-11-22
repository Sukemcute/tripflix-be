import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { calculateCompleteness } from '../../../content/index.js';
import { RECOMMEND_STORE, type RecommendStore } from '../../recommend/application/ports.js';
import { buildIndex } from '../domain/explore/build.js';
import { searchExplore, type ExploreItem, type Relax } from '../domain/explore/rank.js';
import type { Understood } from '../domain/explore/query.js';
import { paginate } from '../domain/stays.js';
import { NS } from '../domain/explore/stats.js';
import { destOf } from '../domain/explore/text.js';
import { placeBucketOfId, placeParentOf, placesIn } from '../domain/places.js';
import { QUERY_TOTAL_KEYS, queryGrams, rankVocabGaps, type QueryGramRow, type VocabGap } from '../domain/explore/vocab-gaps.js';
import type { ExploreObject } from '../domain/explore/types.js';
import { POI_ATTRIBUTION, type PointOfInterestSeed } from '../domain/points-of-interest.js';
import { EXPLORE_CATALOG, EXPLORE_STORE, PLACES_STORE, type PlacesStore, type ExploreCatalog, type ExploreHotel, type ExplorePost, type ExploreStore } from './ports.js';

/** Chặn vòng lặp nếu nguồn trả con trỏ lặp lại. */
const MAX_PAGES = 1_000;
const POST_KINDS = new Set(['post', 'plan', 'video']);
/** Vùng của từng postType khi tìm bài; `all` gộp cả ba theo thứ tự engine xếp. `article`: mọi bài không phải video. */
const POST_TYPE_KINDS = { all: ['plan', 'video', 'post'], plan: ['plan'], video: ['video'], post: ['post'], article: ['plan', 'post'] } as const;
export type PostType = keyof typeof POST_TYPE_KINDS;
export const POST_TYPES = Object.keys(POST_TYPE_KINDS) as PostType[];
// ponytail: lấy tối đa chừng này bài khớp rồi cắt trang trong RAM; đủ cho vài nghìn bài, lớn hơn thì phân trang trong engine.
const MAX_POST_RESULTS = 1_000;
const DAY_MS = 24 * 3600 * 1000;
/** Giữ đếm câu tìm chừng này ngày; endpoint admin xem tối đa chừng này. */
export const QUERY_GRAMS_RETENTION_DAYS = 90;
/** Ngày UTC dạng YYYY-MM-DD, `daysAgo` ngày trước `now`. */
export const dayOf = (now: Date, daysAgo = 0) => new Date(now.getTime() - daysAgo * DAY_MS).toISOString().slice(0, 10);

export interface VocabGapsQuery {
  days: number;
  limit: number;
  minCount: number;
}

export interface VocabGapsPage {
  days: number;
  /** Số câu tìm đã đếm trong `days` ngày. */
  queries: number;
  items: VocabGap[];
}

export interface ExploreQuery {
  q: string;
  loc?: { lat: number; lng: number } | null;
}

export const POST_SORTS = ['relevance', 'trending', 'recent'] as const;
export type PostSort = (typeof POST_SORTS)[number];

export interface PostSearchQuery {
  q: string;
  postType: PostType;
  sort?: PostSort;
  cursor?: string;
  limit: number;
}

/** Loại chỗ, điểm cho tab tìm riêng (khách sạn, điểm tham quan, quán ăn, quán nước). */
export const PLACE_KINDS = ['stay', 'see', 'food', 'cafe'] as const;
export type PlaceKind = (typeof PLACE_KINDS)[number];

export interface PlaceSearchQuery {
  q: string;
  kind: PlaceKind;
  cursor?: string;
  limit: number;
}

export interface PlaceSearchPage extends PostSearchPage {
  /** Dòng ghi nguồn khi trang có điểm OpenStreetMap (ODbL); null nếu không. */
  attribution: string | null;
}

export interface PostSearchPage {
  understood: ExploreResultPage['understood'];
  items: ExploreResultItem[];
  /** Số bài khớp (đã bỏ bài bị ẩn), trên mọi trang. */
  total: number;
  nextCursor: string | null;
  /** Từ trong câu mà dữ liệu không có (chỉ có khi `isFallback`), để FE nói "không thấy 'mùa thu', gợi ý theo Hà Nội". */
  dropped: string[];
  /** true: không bài nào khớp đủ câu, `items` là kết quả thay thế sau khi nới điều kiện (xem `fallbackRelaxed`). */
  isFallback: boolean;
  /** Điều kiện đã nới khi `isFallback` (vượt ngân sách, khác nơi, bỏ từ); rỗng nếu không. */
  fallbackRelaxed: Relax[];
}

export interface ExploreResultItem {
  /** `<loại>:<mã gốc>`, vd `hotel:VP-DL-01`, `post:<uuid>`. */
  id: string;
  kind: string;
  refId: string;
  /** stay: mã trên URL trang chi tiết khách sạn; null với mục khác. */
  slug: string | null;
  title: string;
  subtitle: string | null;
  thumbnail: string | null;
  reason: string;
  priceFrom: number | null;
  days: number | null;
  location: { lat: number; lng: number } | null;
  /** Bài: lượt thích; null nếu không phải bài. */
  likes: number | null;
  /** Bài: số bình luận; null nếu không phải bài. */
  comments: number | null;
  /** Bài: ngày đăng (ISO); null nếu không phải bài hoặc chỉ mục chưa dựng lại. */
  createdAt: string | null;
  /** Bài: tác giả; avatar chưa có dữ liệu nên luôn null (như feed). */
  author: { id: string; name: string | null; avatarUrl: string | null } | null;
}

/** Tên tác giả theo id, tra một lần cho cả trang. */
type AuthorNames = ReadonlyMap<string, string>;

export interface ExploreResultSection {
  kind: string;
  label: string;
  total: number;
  items: ExploreResultItem[];
}

export interface ExploreResultPage {
  understood: {
    place: string | null;
    intents: string[];
    budget: number | null;
    days: number | null;
    names: string[];
    phrases: string[];
    fixed: Record<string, string>;
  };
  nearUser: boolean;
  sections: ExploreResultSection[];
  /** Kết quả thay thế khi vùng câu muốn không có mục nào khớp đủ câu; null nếu có kết quả chính hoặc không có gì liên quan. */
  fallback: ExploreFallbackPage | null;
  /** @deprecated dùng `fallback.items`. */
  suggest: Array<ExploreResultItem & { section: string }>;
  /** @deprecated dùng `fallback.dropped`. */
  dropped: string[];
}

export interface ExploreFallbackPage {
  /** Câu người dùng gõ, để FE nói "Kết quả thay thế cho …". */
  forQuery: string;
  /** Điều kiện đã nới, gộp trên các mục. */
  relaxed: Relax[];
  /** Từ trong câu mà các mục thay thế không khớp. */
  dropped: string[];
  items: Array<ExploreResultItem & { section: string; relaxed: Relax[] }>;
}

function hotelPlace(h: Pick<ExploreHotel, 'province' | 'city'>): string {
  const provinceId = placesIn(h.province.name)[0] ?? null;
  const cityId = h.city ? (placesIn(h.city)[0] ?? null) : null;
  // Chỉ dùng city khi cùng nhánh với tỉnh của khách sạn (tránh city nhiễu như 'Hà Nội' kéo khách sạn Bắc Ninh sang Hà Nội).
  const chosen = cityId && (!provinceId || placeParentOf(cityId) === provinceId) ? cityId : provinceId;
  return chosen ? (placeBucketOfId(chosen) ?? h.province.name) : h.province.name;
}

export function hotelToObject(h: ExploreHotel): ExploreObject {
  return {
    id: `hotel:${h.id}`,
    refId: h.id,
    slug: h.slug ?? null,
    kind: 'stay',
    src: 'commerce',
    title: h.name,
    text: [h.brand, h.style, h.city, h.province.name].filter(Boolean).join(' · '),
    addr: h.address,
    place: hotelPlace(h),
    lat: h.location?.lat ?? null,
    lon: h.location?.lng ?? null,
    priceNight: h.priceFrom,
    stars: h.stars,
    thumbnail: h.thumbnail,
  };
}

// Tag OSM tiếng Anh: thêm chữ tiếng Việt để câu "bảo tàng đà nẵng" khớp.
const POI_TAG_WORDS: Record<string, string> = {
  beach: 'biển bãi biển',
  viewpoint: 'ngắm cảnh check in',
  museum: 'bảo tàng',
  park: 'công viên',
  market: 'chợ',
  temple: 'chùa đền nhà thờ',
  indoor: 'trong nhà',
};

/** Điểm OSM -> nhánh Ăn uống (food, cafe) hoặc Tham quan (see). Chỗ ở ngoài Tripflix thì null: không trộn với khách sạn đặt được. */
export function pointToObject(p: PointOfInterestSeed, city: string): ExploreObject | null {
  if (p.kind === 'lodging') return null;
  return {
    id: `poi:${p.id}`,
    refId: p.id,
    kind: p.kind,
    src: 'osm',
    title: p.name,
    text: [city, ...p.tags.map((t) => POI_TAG_WORDS[t] ?? t)].filter(Boolean).join(' · '),
    place: destOf(city) ?? (city || null),
    lat: p.lat,
    lon: p.lng,
  };
}

/** Bài video -> nhánh Video; bài có lộ trình (số ngày) -> Lộ trình; còn lại -> Bài viết. */
export function postToObject(p: ExplorePost): ExploreObject {
  const trip = p.tripAttachment;
  const days = trip?.daysCount ?? null;
  const isVideo = p.postType === 'video';
  return {
    id: `post:${p.id}`,
    refId: p.id,
    kind: isVideo ? 'video' : days ? 'plan' : 'post',
    src: 'content',
    title: p.title,
    text: [p.body, ...p.hashtags.map((h) => (h.startsWith('#') ? h : `#${h}`))].join(' '),
    place: destOf(`${trip?.destinationName ?? ''} ${p.title}`),
    days,
    cost: trip?.estimatedCostPerPerson ?? null,
    likes: p.reactionTotal,
    n: p.commentCount,
    topics: isVideo && days ? ['plan'] : [],
    thumbnail: p.posterUrl ?? null,
    authorId: p.authorId,
    createdAt: new Date(p.createdAt).toISOString(),
    completeness: calculateCompleteness({
      mediaIds: p.mediaIds ?? [],
      coverMediaId: p.coverMediaId ?? null,
      body: p.body,
      hashtags: p.hashtags,
      tripAttachment: p.tripAttachment,
    }),
  };
}

const understoodOf = (u: Understood): ExploreResultPage['understood'] => ({
  place: u.place, intents: u.intents, budget: u.budget, days: u.days, names: u.names, phrases: u.phrases, fixed: u.fixed,
});

/** Danh sách bài: lý do luôn có số ngày và lượt thích (engine chỉ ghi lượt thích cho bài viết thường). */
function postReason({ obj, reason }: ExploreItem): string {
  const why = reason ? [reason] : [];
  if (obj.days && !reason.includes('ngày')) why.unshift(`${obj.days} ngày`);
  if (!reason.includes('♥')) why.push(`♥ ${obj.likes ?? 0}`);
  return why.join(' · ');
}

function toResultItem({ obj, reason }: ExploreItem, names: AuthorNames): ExploreResultItem {
  const isPost = POST_KINDS.has(obj.kind);
  return {
    id: obj.id,
    kind: obj.kind,
    refId: obj.refId ?? obj.id,
    slug: obj.slug ?? null,
    title: obj.title,
    subtitle: obj.place ?? null,
    thumbnail: obj.thumbnail ?? null,
    reason,
    priceFrom: obj.priceNight ?? obj.cost ?? null,
    days: obj.days ?? null,
    location: obj.lat != null && obj.lon != null ? { lat: obj.lat, lng: obj.lon } : null,
    likes: isPost ? (obj.likes ?? 0) : null,
    comments: isPost ? (obj.n ?? 0) : null,
    createdAt: isPost ? (obj.createdAt ?? null) : null,
    author: isPost && obj.authorId ? { id: obj.authorId, name: names.get(obj.authorId) ?? null, avatarUrl: null } : null,
  };
}

async function readAll<T>(list: (cursor: string | null) => Promise<{ items: T[]; nextCursor: string | null }>): Promise<T[]> {
  const all: T[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await list(cursor);
    all.push(...res.items);
    if (!res.nextCursor || res.nextCursor === cursor) break;
    cursor = res.nextCursor;
  }
  return all;
}

/** Tìm khám phá (app): một ô tìm, kết quả chia theo vùng. Chỉ mục ở schema discovery, dựng lại bằng job. */
@Injectable()
export class ExploreUseCases {
  private readonly logger = new Logger(ExploreUseCases.name);

  constructor(
    @Inject(EXPLORE_STORE) private readonly store: ExploreStore,
    @Inject(EXPLORE_CATALOG) private readonly catalog: ExploreCatalog,
    @Inject(PLACES_STORE) private readonly places: Pick<PlacesStore, 'listPlaces' | 'listPoints'>,
    @Optional() @Inject(RECOMMEND_STORE) private readonly recommendStore?: Pick<RecommendStore, 'findPostScores'>,
  ) {}

  async search(query: ExploreQuery): Promise<ExploreResultPage> {
    const loc = query.loc ? { lat: query.loc.lat, lon: query.loc.lng } : null;
    const r = await searchExplore(this.store, query.q, { loc });
    this.logQuery(query.q, r.understood);
    // Chỉ mục có thể trễ một chu kỳ job: bài vừa bị ẩn/xoá không được lọt ra kết quả.
    const all = [...r.sections.flatMap((s) => s.items), ...(r.fallback?.items ?? [])];
    const postIds = [...new Set(all.filter((i) => POST_KINDS.has(i.obj.kind)).map((i) => i.obj.refId ?? ''))];
    const visible = postIds.length ? await this.catalog.findVisiblePostIds(postIds) : new Set<string>();
    const isShown = (i: ExploreItem) => !POST_KINDS.has(i.obj.kind) || visible.has(i.obj.refId ?? '');
    const names = await this.authorNames(all.filter(isShown));
    const toItem = (i: ExploreItem) => toResultItem(i, names);
    const fallback = r.fallback && {
      forQuery: query.q,
      relaxed: r.fallback.relaxed,
      dropped: r.fallback.dropped,
      items: r.fallback.items.filter(isShown).map((i) => ({ ...toItem(i), section: i.section ?? '', relaxed: i.relaxed ?? [] })),
    };
    return {
      understood: understoodOf(r.understood),
      nearUser: r.nearUser,
      // total đếm trên chỉ mục: bài bị ẩn được gỡ trong vài giây (dropHidden), giữa lúc đó total có thể dư.
      sections: r.sections.map((s) => ({ kind: s.kind, label: s.label, total: s.total, items: s.items.filter(isShown).map(toItem) })),
      fallback: fallback?.items.length ? fallback : null,
      suggest: r.fallback ? r.fallback.items.filter(isShown).map((i) => ({ ...toItem(i), section: i.section ?? '' })) : [],
      dropped: fallback?.items.length ? fallback.dropped : [],
    };
  }

  /**
   * Tìm bài (lộ trình, video, bài viết) bằng câu tự nhiên, có phân trang. Cùng engine với search(), chỉ lấy các vùng bài.
   * Video kèm lộ trình nằm ở cả vùng Lộ trình và Video: với `all` chỉ trả một lần.
   */
  async searchPosts(query: PostSearchQuery): Promise<PostSearchPage> {
    const kinds: readonly string[] = POST_TYPE_KINDS[query.postType];
    const r = await searchExplore(this.store, query.q, { perSection: MAX_POST_RESULTS, fullKinds: kinds });
    // Lật trang không phải một lượt tìm mới.
    if (!query.cursor) this.logQuery(query.q, r.understood);
    const seen = new Set<string>();
    // Vùng Lộ trình có cả video kèm lộ trình: `article` bỏ mọi video. Kết quả thay thế lọc theo loại của bài nên không cần.
    const isWanted = (i: ExploreItem) => query.postType !== 'article' || i.obj.kind !== 'video';
    const found = r.sections
      .filter((s) => kinds.includes(s.kind))
      .flatMap((s) => s.items)
      .filter((i) => isWanted(i) && !seen.has(i.obj.id) && Boolean(seen.add(i.obj.id)));
    // Không bài nào khớp đủ câu ('mùa thu hà nội' khi chưa ai viết về mùa thu, lộ trình vượt ngân sách): dùng kết quả thay thế, như /search.
    const fallback = found.length === 0 ? r.fallback : null;
    const isFallback = Boolean(fallback?.items.length);
    const candidates = isFallback
      ? fallback!.items.filter((i) => (query.postType === 'all' ? POST_KINDS.has(i.obj.kind) : kinds.includes(i.obj.kind)) && !seen.has(i.obj.id) && Boolean(seen.add(i.obj.id)))
      : found;
    const visible = candidates.length ? await this.catalog.findVisiblePostIds(candidates.map((i) => i.obj.refId ?? '')) : new Set<string>();
    const shown = candidates.filter((i) => visible.has(i.obj.refId ?? ''));
    const sorted = await this.sortPostItems(shown, query.sort ?? 'relevance');
    const page = paginate(sorted, query.cursor, query.limit);
    const names = await this.authorNames(page.items);
    return {
      understood: understoodOf(r.understood),
      items: page.items.map((i) => toResultItem({ ...i, reason: postReason(i) }, names)),
      total: sorted.length,
      nextCursor: page.nextCursor,
      dropped: isFallback && sorted.length > 0 ? fallback!.dropped : [],
      isFallback: isFallback && sorted.length > 0,
      fallbackRelaxed: isFallback && sorted.length > 0 ? fallback!.relaxed : [],
    };
  }

  private async sortPostItems(shown: ExploreItem[], sort: PostSort): Promise<ExploreItem[]> {
    if (sort === 'relevance' || shown.length <= 1) return shown;

    if (sort === 'recent') {
      return shown
        .map((item, idx) => {
          const ms = item.obj.createdAt ? Date.parse(item.obj.createdAt) : Number.NaN;
          return { item, idx, time: Number.isFinite(ms) ? ms : null };
        })
        .sort((a, b) => {
          if (a.time !== null && b.time !== null && b.time !== a.time) return b.time - a.time;
          if (a.time !== null && b.time === null) return -1;
          if (a.time === null && b.time !== null) return 1;
          return a.idx - b.idx;
        })
        .map((x) => x.item);
    }

    // sort === 'trending': đọc điểm hot@v2; lỗi đọc điểm thì log warn và giữ relevance.
    if (!this.recommendStore) return shown;
    let scores: Map<string, number>;
    try {
      const postIds = shown.map((i) => i.obj.refId ?? '').filter(Boolean);
      scores = await this.recommendStore.findPostScores('hot@v2', postIds);
    } catch (error) {
      this.logger.warn(`Đọc điểm hot@v2 khi sort trending lỗi, giữ relevance: ${(error as Error).message}`);
      return shown;
    }
    return shown
      .map((item, idx) => ({ item, idx, score: scores.get(item.obj.refId ?? '') ?? 0 }))
      .sort((a, b) => b.score - a.score || a.idx - b.idx)
      .map((x) => x.item);
  }

  /** Tìm một loại chỗ, điểm (tab riêng của trang tìm), có phân trang. Cùng engine với search(). */
  async searchPlaces(query: PlaceSearchQuery): Promise<PlaceSearchPage> {
    const r = await searchExplore(this.store, query.q, { perSection: MAX_POST_RESULTS, fullKinds: [query.kind] });
    if (!query.cursor) this.logQuery(query.q, r.understood);
    const found = r.sections.find((s) => s.kind === query.kind)?.items ?? [];
    const relaxed = found.length === 0 ? (r.fallback?.items.filter((i) => i.obj.kind === query.kind) ?? []) : [];
    const isFallback = relaxed.length > 0;
    const candidates = isFallback ? relaxed : found;
    const page = paginate(candidates, query.cursor, query.limit);
    return {
      understood: understoodOf(r.understood),
      items: page.items.map((i) => toResultItem(i, new Map())),
      total: candidates.length,
      nextCursor: page.nextCursor,
      dropped: isFallback ? r.fallback!.dropped : [],
      isFallback,
      fallbackRelaxed: isFallback ? r.fallback!.relaxed : [],
      attribution: page.items.some((i) => i.obj.src === 'osm') ? POI_ATTRIBUTION : null,
    };
  }

  /** Khoảng trống từ vựng `days` ngày gần nhất: n-gram người tìm dùng nhiều hơn hẳn nội dung, gom kiểu viết gần nhau. */
  async vocabGaps(query: VocabGapsQuery, now = new Date()): Promise<VocabGapsPage> {
    const rows = await this.store.listQueryGrams(dayOf(now, query.days - 1), query.minCount);
    const hitsOf = (key: string) => rows.find((r) => r.gram === key)?.hits ?? 0;
    const grams = rows.filter((r) => !r.gram.startsWith('#'));
    const counts = await this.store.counts([
      ...grams.map((r) => ({ ns: NS.ngram, key: r.gram })),
      { ns: NS.ngramTotal, key: '1' },
      { ns: NS.ngramTotal, key: '2' },
    ]);
    const content = new Map(counts.map((c) => [`${c.ns}:${c.key}`, c.n]));
    const items = rankVocabGaps(
      grams,
      { 1: hitsOf(QUERY_TOTAL_KEYS[1]), 2: hitsOf(QUERY_TOTAL_KEYS[2]) },
      {
        count: (gram) => content.get(`${NS.ngram}:${gram}`) ?? 0,
        totals: { 1: content.get(`${NS.ngramTotal}:1`) ?? 0, 2: content.get(`${NS.ngramTotal}:2`) ?? 0 },
      },
    );
    return { days: query.days, queries: hitsOf(QUERY_TOTAL_KEYS.queries), items: items.slice(0, query.limit) };
  }

  /** Đếm n-gram của câu tìm cho vocabGaps. Bắn rồi quên: không làm chậm lượt tìm, lỗi chỉ ghi log. Không lưu người tìm. */
  private logQuery(q: string, u: Understood): void {
    const { grams, totals } = queryGrams(u);
    const rows: QueryGramRow[] = [
      { gram: QUERY_TOTAL_KEYS.queries, hits: 1, samples: [] },
      { gram: QUERY_TOTAL_KEYS[1], hits: totals[1], samples: [] },
      { gram: QUERY_TOTAL_KEYS[2], hits: totals[2], samples: [] },
      ...grams.map((gram) => ({ gram, hits: 1, samples: [q.trim()] })),
    ];
    void this.store
      .recordQueryGrams(dayOf(new Date()), rows)
      .catch((error: unknown) => this.logger.warn(`Ghi đếm câu tìm lỗi: ${(error as Error).message}`));
  }

  private async authorNames(items: ExploreItem[]): Promise<AuthorNames> {
    const ids = [...new Set(items.flatMap((i) => (i.obj.authorId ? [i.obj.authorId] : [])))];
    return ids.length ? this.catalog.getAuthorNames(ids) : new Map();
  }

  /** Dựng lại toàn bộ chỉ mục từ commerce + content + điểm OSM. Trả số tài liệu, hoặc null nếu worker khác đang dựng. */
  async rebuildIndex(): Promise<number | null> {
    const [hotels, posts, places, points] = await Promise.all([
      readAll((c) => this.catalog.listHotels(c)),
      readAll((c) => this.catalog.listPosts(c)),
      this.places.listPlaces(),
      this.places.listPoints(),
    ]);
    const placeName = new Map(places.map((p) => [p.id, p.name]));
    const pois = points.flatMap((p) => pointToObject(p, placeName.get(p.cityId) ?? '') ?? []);
    const index = buildIndex([...hotels.map(hotelToObject), ...posts.map(postToObject), ...pois]);
    if (!(await this.store.replaceAll(index))) return null;
    // Bài bị ẩn sau lúc đọc ở trên đã bị replaceAll ghi lại, và lượt xoá của consumer có thể đã hụt vì đụng transaction.
    // Hỏi lại Content sau khi commit thì bắt được hết: Content lưu trạng thái ẩn trước khi phát event.
    // Lỗi ở đây chỉ để lại bài ẩn tới lượt sau, chỉ mục mới vẫn dùng được.
    // ponytail: hỏi một lần cho mọi bài; chia lô khi lên hàng chục nghìn bài.
    try {
      await this.dropHidden(posts.map((p) => p.id));
    } catch (error) {
      this.logger.error(`Dọn bài ẩn sau khi dựng chỉ mục lỗi: ${(error as Error).message}`);
    }
    return index.docs.length;
  }

  /**
   * Gỡ khỏi chỉ mục những bài trong postIds không còn hiện công khai, trả số bài thật sự bị gỡ
   * (0 nếu bài ẩn đã không còn trong chỉ mục). Gọi lại nhiều lần vẫn cho cùng chỉ mục.
   */
  async dropHidden(postIds: string[]): Promise<number> {
    if (!postIds.length) return 0;
    const visible = await this.catalog.findVisiblePostIds(postIds);
    const hidden = postIds.filter((id) => !visible.has(id));
    return this.store.deleteDocuments(hidden.map((id) => `post:${id}`));
  }
}
