import type { Candidate, Kind, PostBuildOutput, PostMeta, RawRow, UserBuildOutput } from '../domain/contracts.js';
import type { OrderCancellation } from '../domain/ingest/to-raw-rows.js';
import type { AlgoRow } from '../domain/registry.js';

export const RECOMMEND_STORE = Symbol('RECOMMEND_STORE');
export const RECOMMEND_CATALOG = Symbol('RECOMMEND_CATALOG');

/** Bài đang hiện công khai cho gợi ý. Thật: ContentFacade.listPosts (VisiblePostSummary). */
export interface RecommendSourcePost {
  id: string;
  authorId: string;
  postType: string;
  title: string;
  hashtags: string[];
  isVerified: boolean;
  tripAttachment: { hotelId?: string; destinationName?: string } | null;
  /** listPosts không có publishedAt: dùng createdAt. */
  createdAt: Date;
}

type Page<T> = { items: T[]; nextCursor: string | null };

/** Nguồn dữ liệu module khác cho bộ điều phối gợi ý, đọc theo trang. */
export interface RecommendCatalog {
  listPosts(cursor: string | null): Promise<Page<RecommendSourcePost>>;
  /** Khách sạn → tỉnh (province.slug). Thật: CommerceFacade.listCatalog. */
  listHotelProvinces(cursor: string | null): Promise<Page<{ id: string; provinceSlug: string }>>;
  /** Trong postIds, bài còn hiện công khai kèm nội dung thẻ. Thật: ContentFacade.getVisiblePosts. */
  getVisiblePosts(postIds: string[]): Promise<RecommendCardPost[]>;
}

export interface RecommendCardPost {
  id: string;
  postType: string;
  title: string;
  hashtags: string[];
  coverMediaId: string | null;
  authorId: string;
  reactionTotal: number;
}

export const SERVED_STORE = Symbol('SERVED_STORE');

/** Bài đã phục vụ cho mỗi người (chống lặp giữa các trang, 48 giờ, ≤ 100 id). Thật: Redis. */
export interface ServedStore {
  /** Bài đã gợi ý trước thời điểm `before` (các phiên trước). */
  listBefore(userId: string, before: Date): Promise<string[]>;
  add(userId: string, postIds: string[], at: Date): Promise<void>;
}

export const RECENT_POSTS_STORE = Symbol('RECENT_POSTS_STORE');

/** Bài người dùng vừa tương tác (gu trong phiên, ≤ 20 bài, 2 giờ). Thật: Redis. Mất thì job 10 phút vẫn tính đủ. */
export interface RecentPostsStore {
  /** Bài tương tác trong 2 giờ tới `until`, kèm lúc tương tác (ms). */
  list(userId: string, until: Date): Promise<Array<{ postId: string; at: number }>>;
  record(userId: string, change: { add: Array<{ postId: string; at: number }>; remove: string[] }): Promise<void>;
}

export interface RecommendPostRow extends PostMeta {
  isVerified: boolean;
  publishedAt: Date;
}

export type InteractionCounts = Map<string, { d30: Partial<Record<Kind, number>>; h24: Partial<Record<Kind, number>> }>;

export interface CandidateQuery {
  /** 'hot@v0' */
  postBuilder: string;
  postType: string | null;
  /** Bài đã tương tác, đã phục vụ: không lấy. */
  excludePostIds: string[];
  limit: number;
  now: Date;
}

/** Bảng gợi ý của discovery trên Postgres. */
export interface RecommendStore {
  // Nạp sự kiện
  /** Một câu upsert; chỉ ghi đè khi occurred_at mới hơn (giao lại không ghi đôi, sự kiện cũ không đè). */
  upsertInteractions(rows: RawRow[], meta: { source: string; eventId: string }): Promise<void>;
  /** Đánh dấu gỡ mọi dòng order_item `orderId:*` của người đó xảy ra trước lúc huỷ. Trả số dòng. */
  cancelOrderItems(cancel: OrderCancellation): Promise<number>;

  // Bộ điều phối
  /** Chạy fn khi giữ được khoá advisory `name`; worker khác đang giữ thì trả null (bỏ lượt). */
  withLock<T>(name: string, fn: () => Promise<T>): Promise<T | null>;
  /** Thay toàn bộ recommend_posts bằng danh sách bài đang hiện. Danh sách rỗng thì không xoá gì, trả false (bỏ lượt). */
  replacePosts(posts: RecommendPostRow[]): Promise<boolean>;
  /** Đếm tương tác theo bài, 30 ngày và 24 giờ, bỏ is_removed, chỉ occurred_at ≤ now. */
  countPostInteractions(now: Date): Promise<InteractionCounts>;
  /** Thay toàn bộ điểm của một post builder (một lô gồm mọi bài). */
  replacePostScores(builderKey: string, scores: Array<PostBuildOutput & { postType: string }>): Promise<void>;
  /** Người có dòng thô trong 30 ngày tới now. */
  listActiveUserIds(now: Date): Promise<string[]>;
  /** Người có dòng mới nạp sau watermark (để cộng dồn ở bước 2, chưa dùng). */
  listDirtyUserIds(watermark: Date): Promise<string[]>;
  /** Dòng thô 30 ngày của các người dùng, chỉ occurred_at ≤ now. */
  listUserRows(userIds: string[], now: Date): Promise<RawRow[]>;
  upsertUserFeatures(builderKey: string, features: UserBuildOutput[]): Promise<void>;
  setJobState(name: string, state: { lastRunAt: Date; lastError: string | null; watermark?: Date }): Promise<void>;

  // Endpoint
  listActiveAlgos(): Promise<AlgoRow[]>;
  findUserFeatures(builderKey: string, userId: string): Promise<Record<string, unknown> | null>;
  /** Bài người dùng đã tương tác (kể cả bài của chính họ). */
  listInteractedPostIds(userId: string, now: Date): Promise<string[]>;
  /** Tag, nơi của các bài trong recommend_posts (bảng đọc, không phải bảng thô). */
  findPostMetas(postIds: string[]): Promise<PostMeta[]>;
  /** Ứng viên theo score desc, published_at desc, post_id desc (phá hoà cố định). */
  listHotCandidates(q: CandidateQuery): Promise<Candidate[]>;
  /** Bài đăng trong `hours` giờ tới now, mới nhất trước. */
  listFreshCandidates(q: CandidateQuery & { hours: number }): Promise<Candidate[]>;
  /** Pool explore: bài trong `days` ngày, mới nhất trước. */
  listExplorePool(q: CandidateQuery & { days: number }): Promise<Candidate[]>;

  // Dọn hạn lưu
  /** Xoá một lô dòng hết hạn, trả số dòng đã xoá. */
  purgeExpired(now: Date, batchSize: number): Promise<number>;
}
