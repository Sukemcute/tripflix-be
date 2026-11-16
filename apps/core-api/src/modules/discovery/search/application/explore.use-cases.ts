import { Inject, Injectable, Logger } from '@nestjs/common';
import { buildIndex } from '../domain/explore/build.js';
import { searchExplore, type ExploreItem, type Relax } from '../domain/explore/rank.js';
import type { Understood } from '../domain/explore/query.js';
import { paginate } from '../domain/stays.js';
import { destOf } from '../domain/explore/text.js';
import type { ExploreObject } from '../domain/explore/types.js';
import { EXPLORE_CATALOG, EXPLORE_STORE, type ExploreCatalog, type ExploreHotel, type ExplorePost, type ExploreStore } from './ports.js';

/** Chặn vòng lặp nếu nguồn trả con trỏ lặp lại. */
const MAX_PAGES = 1_000;
const POST_KINDS = new Set(['post', 'plan', 'video']);
/** Vùng của từng postType khi tìm bài; `all` gộp cả ba theo thứ tự engine xếp. */
const POST_TYPE_KINDS = { all: ['plan', 'video', 'post'], plan: ['plan'], video: ['video'], post: ['post'] } as const;
export type PostType = keyof typeof POST_TYPE_KINDS;
export const POST_TYPES = Object.keys(POST_TYPE_KINDS) as PostType[];
// ponytail: lấy tối đa chừng này bài khớp rồi cắt trang trong RAM; đủ cho vài nghìn bài, lớn hơn thì phân trang trong engine.
const MAX_POST_RESULTS = 1_000;

export interface ExploreQuery {
  q: string;
  loc?: { lat: number; lng: number } | null;
}

export interface PostSearchQuery {
  q: string;
  postType: PostType;
  cursor?: string;
  limit: number;
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
  title: string;
  subtitle: string | null;
  thumbnail: string | null;
  reason: string;
  priceFrom: number | null;
  days: number | null;
  location: { lat: number; lng: number } | null;
}

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

export function hotelToObject(h: ExploreHotel): ExploreObject {
  return {
    id: `hotel:${h.id}`,
    refId: h.id,
    kind: 'stay',
    src: 'commerce',
    title: h.name,
    text: [h.brand, h.style, h.city, h.province.name].filter(Boolean).join(' · '),
    addr: h.address,
    place: destOf(`${h.province.name} ${h.city ?? ''}`) ?? h.province.name,
    lat: h.location?.lat ?? null,
    lon: h.location?.lng ?? null,
    priceNight: h.priceFrom,
    stars: h.stars,
    thumbnail: h.thumbnail,
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

function toItem({ obj, reason }: ExploreItem): ExploreResultItem {
  return {
    id: obj.id,
    kind: obj.kind,
    refId: obj.refId ?? obj.id,
    title: obj.title,
    subtitle: obj.place ?? null,
    thumbnail: obj.thumbnail ?? null,
    reason,
    priceFrom: obj.priceNight ?? obj.cost ?? null,
    days: obj.days ?? null,
    location: obj.lat != null && obj.lon != null ? { lat: obj.lat, lng: obj.lon } : null,
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
  ) {}

  async search(query: ExploreQuery): Promise<ExploreResultPage> {
    const loc = query.loc ? { lat: query.loc.lat, lon: query.loc.lng } : null;
    const r = await searchExplore(this.store, query.q, { loc });
    // Chỉ mục có thể trễ một chu kỳ job: bài vừa bị ẩn/xoá không được lọt ra kết quả.
    const all = [...r.sections.flatMap((s) => s.items), ...(r.fallback?.items ?? [])];
    const postIds = [...new Set(all.filter((i) => POST_KINDS.has(i.obj.kind)).map((i) => i.obj.refId ?? ''))];
    const visible = postIds.length ? await this.catalog.findVisiblePostIds(postIds) : new Set<string>();
    const isShown = (i: ExploreItem) => !POST_KINDS.has(i.obj.kind) || visible.has(i.obj.refId ?? '');
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
    const seen = new Set<string>();
    const found = r.sections
      .filter((s) => kinds.includes(s.kind))
      .flatMap((s) => s.items)
      .filter((i) => !seen.has(i.obj.id) && Boolean(seen.add(i.obj.id)));
    // Không bài nào khớp đủ câu ('mùa thu hà nội' khi chưa ai viết về mùa thu, lộ trình vượt ngân sách): dùng kết quả thay thế, như /search.
    const fallback = found.length === 0 ? r.fallback : null;
    const isFallback = Boolean(fallback?.items.length);
    const candidates = isFallback
      ? fallback!.items.filter((i) => (query.postType === 'all' ? POST_KINDS.has(i.obj.kind) : kinds.includes(i.obj.kind)) && !seen.has(i.obj.id) && Boolean(seen.add(i.obj.id)))
      : found;
    const visible = candidates.length ? await this.catalog.findVisiblePostIds(candidates.map((i) => i.obj.refId ?? '')) : new Set<string>();
    const shown = candidates.filter((i) => visible.has(i.obj.refId ?? ''));
    const page = paginate(shown, query.cursor, query.limit);
    return {
      understood: understoodOf(r.understood),
      items: page.items.map((i) => toItem({ ...i, reason: postReason(i) })),
      total: shown.length,
      nextCursor: page.nextCursor,
      dropped: isFallback && shown.length > 0 ? fallback!.dropped : [],
      isFallback: isFallback && shown.length > 0,
      fallbackRelaxed: isFallback && shown.length > 0 ? fallback!.relaxed : [],
    };
  }

  /** Dựng lại toàn bộ chỉ mục từ commerce + content. Trả số tài liệu, hoặc null nếu worker khác đang dựng. */
  async rebuildIndex(): Promise<number | null> {
    const [hotels, posts] = await Promise.all([
      readAll((c) => this.catalog.listHotels(c)),
      readAll((c) => this.catalog.listPosts(c)),
    ]);
    const index = buildIndex([...hotels.map(hotelToObject), ...posts.map(postToObject)]);
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
