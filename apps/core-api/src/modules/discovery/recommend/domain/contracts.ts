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

export interface PostBuildItem {
  postId: string;
  authorId: string;
  postType: string;
  tags: string[];
  placeId: string | null;
  /** ISO */
  publishedAt: string;
  /** 30 ngày, bỏ dòng isRemoved. */
  interactions: Partial<Record<Kind, number>>;
  interactions24h: Partial<Record<Kind, number>>;
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
  featuresSchema: ZodType;
  build(items: PostBuildItem[], now: Date): Promise<PostBuildOutput[]>;
}

export interface UserBuilder {
  /** 'tag_affinity@v0' */
  key: string;
  featuresSchema: ZodType;
  build(items: UserBuildItem[], now: Date): Promise<UserBuildOutput[]>;
}

export type CandidateSource = 'hot' | 'taste' | 'fresh' | 'explore';

export interface Candidate extends PostMeta {
  score: number;
  postFeatures: Record<string, unknown>;
  source: CandidateSource;
}

export interface RankedItem {
  postId: string;
  score: number;
  source: CandidateSource;
  /** vd tagMatch, placeMatch, hot, final */
  breakdown: Record<string, number>;
  reason: { code: string; text: string };
}

export interface RankInput {
  /** Đã lọc: bỏ bài đã tương tác, đã phục vụ, bài ẩn. */
  candidates: Candidate[];
  userFeatures: Record<string, unknown> | null;
  now: Date;
}

/** Tất định: không Math.random. Trả đúng các ứng viên được đưa vào (lọc hết thì rỗng). */
export interface Ranker {
  /** Khớp recommend_algos.ranker */
  name: string;
  accepts: { postBuilders: string[]; userBuilders: string[] };
  rank(input: RankInput, params?: Record<string, unknown>): RankedItem[];
}

/** 'hot@v0' → { builder: 'hot', version: 'v0' }: hai cột khoá của bảng đặc trưng. */
export function splitKey(key: string): { builder: string; version: string } {
  const at = key.lastIndexOf('@');
  if (at <= 0 || at === key.length - 1) throw new Error(`Khoá builder sai dạng tên@version: ${key}`);
  return { builder: key.slice(0, at), version: key.slice(at + 1) };
}

export const round4 = (x: number) => Math.round(x * 10_000) / 10_000;
