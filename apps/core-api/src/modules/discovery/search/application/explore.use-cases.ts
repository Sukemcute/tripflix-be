import { Inject, Injectable } from '@nestjs/common';
import { buildIndex } from '../domain/explore/build.js';
import { searchExplore, type ExploreItem } from '../domain/explore/rank.js';
import { destOf } from '../domain/explore/text.js';
import type { ExploreObject } from '../domain/explore/types.js';
import { EXPLORE_CATALOG, EXPLORE_STORE, type ExploreCatalog, type ExploreHotel, type ExplorePost, type ExploreStore } from './ports.js';

/** Chặn vòng lặp nếu nguồn trả con trỏ lặp lại. */
const MAX_PAGES = 1_000;
const POST_KINDS = new Set(['post', 'plan', 'video']);

export interface ExploreQuery {
  q: string;
  loc?: { lat: number; lng: number } | null;
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
  suggest: Array<ExploreResultItem & { section: string }>;
  dropped: string[];
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
  constructor(
    @Inject(EXPLORE_STORE) private readonly store: ExploreStore,
    @Inject(EXPLORE_CATALOG) private readonly catalog: ExploreCatalog,
  ) {}

  async search(query: ExploreQuery): Promise<ExploreResultPage> {
    const loc = query.loc ? { lat: query.loc.lat, lon: query.loc.lng } : null;
    const r = await searchExplore(this.store, query.q, { loc });
    // Chỉ mục có thể trễ một chu kỳ job: bài vừa bị ẩn/xoá không được lọt ra kết quả.
    const all = [...r.sections.flatMap((s) => s.items), ...r.suggest];
    const postIds = [...new Set(all.filter((i) => POST_KINDS.has(i.obj.kind)).map((i) => i.obj.refId ?? ''))];
    const visible = postIds.length ? await this.catalog.findVisiblePostIds(postIds) : new Set<string>();
    const isShown = (i: ExploreItem) => !POST_KINDS.has(i.obj.kind) || visible.has(i.obj.refId ?? '');
    const u = r.understood;
    return {
      understood: { place: u.place, intents: u.intents, budget: u.budget, days: u.days, names: u.names, phrases: u.phrases, fixed: u.fixed },
      nearUser: r.nearUser,
      // ponytail: total chưa trừ bài bị ẩn trong chu kỳ job (tối đa 10 phút); trừ khi cần đếm chính xác.
      sections: r.sections.map((s) => ({ kind: s.kind, label: s.label, total: s.total, items: s.items.filter(isShown).map(toItem) })),
      suggest: r.suggest.filter(isShown).map((i) => ({ ...toItem(i), section: i.section ?? '' })),
      dropped: r.dropped,
    };
  }

  /** Dựng lại toàn bộ chỉ mục từ commerce + content. Trả số tài liệu, hoặc null nếu worker khác đang dựng. */
  async rebuildIndex(): Promise<number | null> {
    const [hotels, posts] = await Promise.all([
      readAll((c) => this.catalog.listHotels(c)),
      readAll((c) => this.catalog.listPosts(c)),
    ]);
    const index = buildIndex([...hotels.map(hotelToObject), ...posts.map(postToObject)]);
    return (await this.store.replaceAll(index)) ? index.docs.length : null;
  }
}
