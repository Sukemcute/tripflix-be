import type { Candidate, Kind, ProductBuildOutput, ProductType, PostBuildOutput, PostInteractionSample, PostMeta, RawRow, UserBuildOutput } from '../domain/contracts.js';
import type { OrderCancellation } from '../domain/ingest/to-raw-rows.js';
import type { AlgoRow } from '../domain/registry.js';

export const RECOMMEND_STORE = Symbol('RECOMMEND_STORE');
export const RECOMMEND_CATALOG = Symbol('RECOMMEND_CATALOG');
export const TEXT_EMBEDDER = Symbol('TEXT_EMBEDDER');

/** Nhúng văn bản thành vector đơn vị. Thật: ai-service POST /embed. null = AI tắt hoặc lỗi (job bỏ nguồn caption). */
export interface TextEmbedder {
  embed(texts: string[]): Promise<{ model: string; vectors: number[][] } | null>;
}

/** Bài đang hiện công khai cho gợi ý. Thật: ContentFacade.listPosts (VisiblePostSummary). */
export interface RecommendSourcePost {
  id: string;
  authorId: string;
  postType: string;
  title: string;
  body: string;
  hashtags: string[];
  isVerified: boolean;
  mediaIds: string[];
  coverMediaId: string | null;
  tripAttachment: {
    hotelId?: string;
    destinationName?: string;
    destinationPlaceId?: string;
    daysCount?: number;
    estimatedCostPerPerson?: number;
    items?: unknown[];
  } | null;
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
  /** Trong postIds, thẻ Reels phát được theo đúng thứ tự (lọc bài ẩn/chưa transcode xong). Thật: FeedFacade.getByIds. */
  getReelCardsByIds?(postIds: string[], viewerId: string | null): Promise<RecommendReelCard[]>;
}

export interface RecommendReelCard {
  postId: string;
  author: { id: string; name: string | null; avatarUrl: string | null; isKol: boolean };
  video: Record<string, unknown>;
  title: string;
  caption: string;
  region: string | null;
  tags: string[];
  linkedProductIds: string[];
  tripAttachment: Record<string, unknown> | null;
  counts: { likes: number; comments: number; saves: number; shares: number };
  viewerState: { liked: boolean; saved: boolean } | null;
  reason: { code: string; text: string } | null;
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

export const PRODUCT_PROFILE_CATALOG = Symbol('PRODUCT_PROFILE_CATALOG');
export const PRODUCT_FEATURE_STORE = Symbol('PRODUCT_FEATURE_STORE');

/** Khách sạn cho hotel builder (TF39). Thật: CommerceFacade.listCatalog, days 30. */
export interface HotelProfileSource {
  id: string;
  provinceSlug: string;
  city: string | null;
  stars: number | null;
  priceFrom: number | null;
  rating: { average: number; count: number } | null;
  location: { lat: number; lng: number } | null;
  /** Mã loại phòng của khách sạn: mục order_item ghi mã loại phòng, không ghi mã khách sạn. */
  roomProductIds: string[];
}

/** Chuyến bay cho flight builder (TF39). Thật: CommerceFacade.listCatalog (type flight), days 30. */
export interface FlightProfileSource {
  flightKey: string;
  fromAirport: string;
  toAirport: string;
  airline: string | null;
  departTime: string | null;
  arriveTime: string | null;
  priceFrom: number | null;
  hasRefundableFare: boolean;
  /** Mã hạng ghế: mục order_item ghi mã hạng ghế, không ghi mã chuyến. */
  cabinProductIds: string[];
}

export interface ProductProfileCatalog {
  listHotelProfiles(cursor: string | null): Promise<Page<HotelProfileSource>>;
  listFlightProfiles(cursor: string | null): Promise<Page<FlightProfileSource>>;
}

/** Hồ sơ sản phẩm trên Postgres (bảng recommend_product_features). Thật: DrizzleRecommendStore. */
export interface ProductFeatureStore {
  /** Số mục (phòng, vé) trong đơn đã trả 30 ngày tới now (bỏ đơn đã huỷ), theo mã loại phòng / mã hạng ghế. */
  countProductBookings(now: Date): Promise<Map<string, number>>;
  /** Thay toàn bộ hồ sơ của một builder trong một transaction. */
  replaceProductFeatures(builderKey: string, productType: ProductType, rows: ProductBuildOutput[]): Promise<void>;
  /** Hồ sơ của các sản phẩm; sản phẩm chưa dựng thì không có trong Map. */
  findProductFeatures(builderKey: string, productIds: string[]): Promise<Map<string, { score: number; features: Record<string, unknown> }>>;
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
  hasPlan: boolean;
  publishedAt: Date;
}

/** Số liệu cho trang admin theo dõi job gợi ý. */
export interface RecommendAdminStats {
  interactionsLast10m: number;
  interactionsLast24h: number;
  posts: number;
  usersWithFeatures: number;
  jobStates: Array<{ name: string; lastRunAt: Date | null; lastError: string | null }>;
}

export type InteractionCounts = Map<string, { d30: Partial<Record<Kind, number>>; h24: Partial<Record<Kind, number>> }>;

export interface CandidateQuery {
  /** 'hot@v0' */
  postBuilder: string;
  postType: string | null;
  /** Chỉ lấy bài có lịch trình (`has_plan = true`). */
  hasPlan?: boolean;
  /** Bài không lấy (explore bỏ bài đã tương tác; hot/fresh để rỗng, bài đã tương tác chỉ bị đẩy xuống cuối). */
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
  /** Đọc tương tác 30 ngày gắn với bài (gồm cả order_item qua detail.sourcePostId) kèm tuổi tài khoản (dùng cho hot@v1). */
  listPostInteractionSamples(now: Date): Promise<Map<string, PostInteractionSample[]>>;
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
  /** Bài người dùng tự đăng trong (since, until], mới nhất trước, đọc dòng `publish` của bảng thô (có ngay, không chờ job). */
  listOwnRecentPostIds(q: { userId: string; since: Date; until: Date; postType: string | null }): Promise<string[]>;
  /** Tỉnh (group_key) của khách sạn theo hồ sơ hotel_profile@v0; khách sạn chưa có hồ sơ thì không có trong kết quả. */
  findProductPlaces(productIds: string[]): Promise<Record<string, string>>;
  /** Tag, nơi của các bài trong recommend_posts (bảng đọc, không phải bảng thô). */
  findPostMetas(postIds: string[]): Promise<PostMeta[]>;
  /** Vector đã nhúng theo sha256 văn bản, chỉ của đúng mô hình đó. Chưa có thì không có trong Map. */
  findTextVectors(model: string, textHashes: string[]): Promise<Map<string, number[]>>;
  /** Ghi vector mới; trùng khoá thì giữ dòng cũ. */
  insertTextVectors(model: string, rows: Array<{ textHash: string; vector: number[] }>): Promise<void>;
  /** Điểm của một post builder (vd 'hot@v2') theo danh sách postId. Bài chưa có điểm không có trong Map. */
  findPostScores(builderKey: string, postIds: string[]): Promise<Map<string, number>>;
  /** Ứng viên theo score desc, published_at desc, post_id desc (phá hoà cố định). */
  listHotCandidates(q: CandidateQuery): Promise<Candidate[]>;
  /** Bài đăng trong `hours` giờ tới now, mới nhất trước. */
  listFreshCandidates(q: CandidateQuery & { hours: number }): Promise<Candidate[]>;
  /** Pool explore: bài trong `days` ngày, mới nhất trước. */
  listExplorePool(q: CandidateQuery & { days: number }): Promise<Candidate[]>;

  // Admin
  /** Đếm trên bảng của discovery: dòng thô nạp gần đây, bài, người có gu; mốc chạy từng builder. */
  getAdminStats(now: Date): Promise<RecommendAdminStats>;

  // Dọn hạn lưu
  /** Xoá một lô dòng hết hạn, trả số dòng đã xoá. */
  purgeExpired(now: Date, batchSize: number): Promise<number>;
}
