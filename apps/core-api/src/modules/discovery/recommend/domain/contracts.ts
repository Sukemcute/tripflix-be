import type { ZodType } from 'zod';

/**
 * Chỗ cắm thuật toán gợi ý (handoff TF28 mục 3). Hàm thuần: không DB, không Redis, không facade.
 * JSON camelCase để builder ngoài tiến trình (Python/Go qua HTTP) sau này nhận đúng cùng dữ liệu.
 */

export const KINDS = [
  'reaction',
  'comment',
  'comment_reaction',
  'bookmark',
  'share',
  'publish',
  'order_item',
  'search',
  'stays_search',
  'view',
  'flight_search',
  'registered',
  'guest_merged',
  'locked',
] as const;
export type Kind = (typeof KINDS)[number];

export interface PostInteractionSample {
  kind: Kind;
  /** Tuổi tài khoản tại thời điểm tính điểm (ngày); null nếu chưa có dòng registered (mặc định trọng số 1). */
  actorAgeDays: number | null;
  /** Số tương tác cùng (loại, tuổi tài khoản): store gom sẵn trong SQL để không kéo từng dòng vào bộ nhớ. */
  count: number;
}

export interface PostBuildItem {
  postId: string;
  authorId: string;
  postType: string;
  tags: string[];
  placeId: string | null;
  /** ISO */
  publishedAt: string;
  /** Điểm hoàn thiện bài viết 0..1 (dùng cho hot@v2). */
  completeness?: number;
  /** Bài có lịch trình hay không (dùng cho hot@v2). */
  hasPlan?: boolean;
  /** 30 ngày, bỏ dòng isRemoved. */
  interactions: Partial<Record<Kind, number>>;
  interactions24h: Partial<Record<Kind, number>>;
  /** Tương tác chi tiết kèm tuổi tài khoản trong 30 ngày (dùng cho hot@v1); nếu thiếu thì fallback về interactions. */
  interactionSamples?: PostInteractionSample[];
  /** Nội dung bài (job truyền dữ liệu thô; builder nào cần thì tự dùng). */
  content?: PostContent;
}

/** Phần lộ trình của bài dùng để xếp ngăn (chi phí, số ngày, loại điểm, khách sạn). */
export interface PostTripSummary {
  hotelId: string | null;
  daysCount: number | null;
  estimatedCostPerPerson: number | null;
  items: Array<{ location: string | null; category: string | null }>;
}

/** score 0..1, chuẩn hoá trên cả lô. */
export interface PostBuildOutput {
  postId: string;
  score: number;
  features: Record<string, unknown>;
}

export interface RawRow {
  actorType: 'user' | 'anon';
  actorId: string;
  kind: Kind;
  refId: string;
  targetType: string | null;
  targetId: string | null;
  value: number | null;
  isRemoved: boolean;
  detail: Record<string, unknown> | null;
  /** ISO */
  occurredAt: string;
}

export interface PostMeta {
  postId: string;
  authorId: string;
  postType: string;
  tags: string[];
  placeId: string | null;
  hasPlan?: boolean;
  /** Nội dung bài (job truyền dữ liệu thô; builder nào cần thì tự dùng). */
  content?: PostContent;
}

/** Nội dung bài job đọc từ listPosts. Dữ liệu thô, không chứa logic thuật toán. */
export interface PostContent {
  title?: string;
  body?: string;
  isVerified?: boolean;
  trip?: PostTripSummary | null;
}

export interface UserBuildItem {
  userId: string;
  /** 30 ngày của người đó. */
  rows: RawRow[];
  /** Bài mà rows đụng tới. */
  posts: Record<string, PostMeta>;
  /** productId khách sạn → placeId. */
  productPlaces: Record<string, string>;
}

export interface UserBuildOutput {
  userId: string;
  features: Record<string, unknown>;
}

export interface PostBuilder {
  /** 'hot@v0' */
  key: string;
  /** Cần interactionSamples (tương tác kèm tuổi tài khoản): job chỉ đọc khi có builder khai báo. */
  needsSamples?: boolean;
  featuresSchema: ZodType;
  build(items: PostBuildItem[], now: Date): Promise<PostBuildOutput[]>;
}

export interface UserBuilder {
  /** 'tag_affinity@v0' */
  key: string;
  featuresSchema: ZodType;
  build(items: UserBuildItem[], now: Date): Promise<UserBuildOutput[]>;
}

/** Một khách sạn cho hotel builder (F10, TF39). Thật: CommerceFacade.listCatalog + đơn đã trả trong bảng thô. */
export interface HotelBuildItem {
  hotelId: string;
  provinceSlug: string;
  /** Thành phố commerce ghi (có thể viết có dấu hoặc không); null khi chưa có. */
  city: string | null;
  stars: number | null;
  /** Giá thấp nhất một đêm một phòng trong 30 ngày tới, gói mặc định; null khi không bán ngày nào. */
  priceFrom: number | null;
  rating: { average: number; count: number } | null;
  location: { lat: number; lng: number } | null;
  /** Mục phòng trong đơn đã trả 30 ngày qua (không tính đơn đã huỷ). */
  bookings30d: number;
}

/** Điểm tham quan, quán ăn, quán cà phê (bảng discovery.points_of_interest). */
export interface HotelPoint {
  name: string;
  kind: 'see' | 'food' | 'cafe';
  lat: number;
  lng: number;
}

export interface HotelBuildInput {
  hotels: HotelBuildItem[];
  points: HotelPoint[];
}

/** Sản phẩm commerce mà builder sản phẩm dựng hồ sơ (bảng recommend_product_features). */
export type ProductType = 'hotel' | 'flight';

/**
 * Hồ sơ một sản phẩm. productId: mã khách sạn hoặc mã chuyến. groupKey: nhóm so sánh (tỉnh của khách sạn, tuyến "SGN-CXR").
 * score 0..1 là chất lượng chung, không phụ thuộc người xem; features đọc lúc xếp hạng.
 */
export interface ProductBuildOutput {
  productId: string;
  groupKey: string;
  score: number;
  features: Record<string, unknown>;
}

export interface ProductBuilder<I> {
  /** 'hotel_profile@v0', 'flight_profile@v0' */
  key: string;
  productType: ProductType;
  featuresSchema: ZodType;
  build(input: I, now: Date): Promise<ProductBuildOutput[]>;
}

export type HotelBuilder = ProductBuilder<HotelBuildInput>;

/** Một chuyến bay cho flight builder (TF39). Thật: CommerceFacade.listCatalog (type flight) + đơn đã trả trong bảng thô. */
export interface FlightBuildItem {
  flightKey: string;
  fromAirport: string;
  toAirport: string;
  airline: string | null;
  /** "HH:MM"; null khi commerce chưa có. */
  departTime: string | null;
  arriveTime: string | null;
  /** Giá thấp nhất một vé người lớn trong 30 ngày tới, gói mặc định; null khi không bán ngày nào. */
  priceFrom: number | null;
  /** Có ít nhất một gói giá hoàn huỷ được (giá có thể khác gói mặc định). */
  hasRefundableFare: boolean;
  /** Mục vé trong đơn đã trả 30 ngày qua (không tính đơn đã huỷ). */
  bookings30d: number;
}

export interface FlightBuildInput {
  flights: FlightBuildItem[];
}

export type FlightBuilder = ProductBuilder<FlightBuildInput>;

/** own: bài người xem tự đăng gần đây (đề xuất mục 6.3), đọc thẳng bảng thô, không chờ job. */
export type CandidateSource = 'hot' | 'taste' | 'fresh' | 'explore' | 'own';

export interface Candidate extends PostMeta {
  score: number;
  postFeatures: Record<string, unknown>;
  source: CandidateSource;
}

export interface RankedItem {
  postId: string;
  authorId: string;
  score: number;
  source: CandidateSource;
  /** vd tagMatch, placeMatch, hot, final */
  breakdown: Record<string, number>;
  reason: { code: string; text: string };
}

export interface RankInput {
  /** Không lọc theo lịch sử người dùng: phạt/cộng điểm theo người là việc của feed-policy.ts. */
  candidates: Candidate[];
  userFeatures: Record<string, unknown> | null;
  now: Date;
  /** Dữ liệu thô của người xem, chỉ có khi ranker khai báo needsViewerRows và người xem đã đăng nhập. */
  viewer?: ViewerRaw | null;
}

/** Dòng thô 30 ngày của người xem + nơi (tỉnh) của sản phẩm trong đơn. Use case chỉ đọc và đưa vào, không xử lý. */
export interface ViewerRaw {
  rows: RawRow[];
  productPlaces: Record<string, string>;
}

/** Tất định: không Math.random. Trả đúng các ứng viên được đưa vào (lọc hết thì rỗng). */
export interface Ranker {
  /** Khớp recommend_algos.ranker */
  name: string;
  accepts: { postBuilders: string[]; userBuilders: string[] };
  /** Số ứng viên hot tối đa use case đọc (mặc định 150). Ranker v1 đọc toàn bộ bài. */
  candidateLimit?: number;
  /** Cần dòng thô của người xem lúc gọi (RankInput.viewer). */
  needsViewerRows?: boolean;
  rank(input: RankInput, params?: Record<string, unknown>): RankedItem[];
}

/** 'hot@v0' → { builder: 'hot', version: 'v0' }: hai cột khoá của bảng đặc trưng. */
export function splitKey(key: string): { builder: string; version: string } {
  const at = key.lastIndexOf('@');
  if (at <= 0 || at === key.length - 1) throw new Error(`Khoá builder sai dạng tên@version: ${key}`);
  return { builder: key.slice(0, at), version: key.slice(at + 1) };
}

export const round4 = (x: number) => Math.round(x * 10_000) / 10_000;
