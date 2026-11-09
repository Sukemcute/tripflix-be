import type { BuiltIndex, ExploreSource } from '../domain/explore/types.js';
import type { HotelSummary, SuggestEntity, SuggestType } from '../domain/suggest-entity.js';

export const SUGGEST_STORE = Symbol('SUGGEST_STORE');
export const HOTEL_CATALOG = Symbol('HOTEL_CATALOG');
export const EXPLORE_STORE = Symbol('EXPLORE_STORE');
export const EXPLORE_CATALOG = Symbol('EXPLORE_CATALOG');

/** Chỉ mục tìm khám phá trên Postgres. */
export interface ExploreStore extends ExploreSource {
  /** Thay toàn bộ chỉ mục trong một transaction. false = worker khác đang dựng, bỏ lượt này. */
  replaceAll(index: BuiltIndex): Promise<boolean>;
  /** Xoá tài liệu theo id (`post:<uuid>`). Id không có trong chỉ mục thì bỏ qua. */
  deleteDocuments(ids: string[]): Promise<void>;
}

/** Khách sạn cho tìm khám phá. Thật: CommerceFacade.listCatalog (CatalogHotel). */
export interface ExploreHotel {
  id: string;
  name: string;
  province: { slug: string; name: string };
  city: string | null;
  stars: number | null;
  brand: string | null;
  style: string | null;
  thumbnail: string | null;
  priceFrom: number | null;
  address: string | null;
  location: { lat: number; lng: number } | null;
}

/** Bài công khai cho tìm khám phá. Thật: ContentFacade.listPosts (VisiblePostSummary). */
export interface ExplorePost {
  id: string;
  postType: string;
  title: string;
  body: string;
  hashtags: string[];
  tripAttachment: { destinationName?: string; daysCount?: number; estimatedCostPerPerson?: number } | null;
  reactionTotal: number;
  commentCount: number;
}

type Page<T> = { items: T[]; nextCursor: string | null };

/** Nguồn dữ liệu module khác cho tìm khám phá, đọc theo trang. */
export interface ExploreCatalog {
  listHotels(cursor: string | null): Promise<Page<ExploreHotel>>;
  listPosts(cursor: string | null): Promise<Page<ExplorePost>>;
  /** Trong postIds, những bài còn hiện công khai. */
  findVisiblePostIds(postIds: string[]): Promise<Set<string>>;
}

export interface SuggestStore {
  /** Ứng viên khớp `normalizedQuery`, xếp sẵn: khớp đầu từ trước, rồi độ giống, rồi độ nổi tiếng. */
  findCandidates(normalizedQuery: string, types: readonly SuggestType[], limit: number): Promise<SuggestEntity[]>;
  /** Thay toàn bộ chỉ mục trong một transaction, người đang tìm không thấy bảng rỗng. */
  replaceAll(entities: readonly SuggestEntity[]): Promise<void>;
}

/** Nguồn danh mục khách sạn, đọc theo trang. Thật: CommerceFacade.listCatalog. */
export interface HotelCatalog {
  listHotels(cursor: string | null): Promise<{ items: HotelSummary[]; nextCursor: string | null }>;
}
