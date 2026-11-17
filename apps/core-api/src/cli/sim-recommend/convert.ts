import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EventEnvelope } from '@tripflix/contracts';
import { STREAMS, type StreamName } from '@tripflix/event-bus';

/**
 * Đổi bộ dữ liệu mô phỏng của Duy (Recommend/data, bộ sinh v2) sang đúng hình dạng của hệ thống thật.
 * Hàm thuần: chỉ đọc file, không ghi DB/Redis. Không đọc posts_truth, exposures và phần đáp án của users_truth.
 */

/** Namespace uuid v5 riêng cho dữ liệu mô phỏng: chạy lại ra cùng uuid, và nhận ra/xoá được mà không đụng dữ liệu thật. */
export const SIM_NAMESPACE = '5f0c7a2e-6b1d-4e8a-9c3f-2d7b1e4a6c90';
export const SIM_EMAIL_DOMAIN = 'sim.tripflix.local';
const DAY_MS = 86_400_000;

/** uuid v5 (RFC 4122) từ namespace + tên. */
export function uuidV5(name: string, namespace = SIM_NAMESPACE): string {
  const ns = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  const hash = createHash('sha1').update(ns).update(name, 'utf8').digest();
  hash[6] = (hash[6]! & 0x0f) | 0x50;
  hash[8] = (hash[8]! & 0x3f) | 0x80;
  const h = hash.subarray(0, 16).toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

export const simId = {
  user: (id: string) => uuidV5(`user:${id}`),
  post: (id: string) => uuidV5(`post:${id}`),
  comment: (id: string) => uuidV5(`comment:${id}`),
  order: (id: string) => uuidV5(`order:${id}`),
  anon: (id: string) => uuidV5(`anon:${id}`),
  event: (id: string) => uuidV5(`event:${id}`),
  row: (kind: string, ...parts: string[]) => uuidV5(`${kind}:${parts.join(':')}`),
};

type Json = Record<string, unknown>;
interface RawEvent {
  eventId: string;
  type: string;
  version: number;
  occurredAt: string;
  stream: string;
  payload: Json;
}
interface RawPost {
  id: string;
  authorId: string;
  postType: 'video' | 'vlog';
  title: string;
  body: string;
  hashtags: string[];
  isVerified: boolean;
  createdAt: string;
  updatedAt: string;
  placeId: string | null;
}
interface RawUser {
  id: string;
  signupDay: number;
  following: string[];
  hasGuestMerged: boolean;
}
interface RawPlace {
  id: string;
  name: string;
}

export interface SimUser {
  id: string;
  simId: string;
  email: string;
  displayName: string;
  createdAt: Date;
}
export interface SimPost {
  id: string;
  simId: string;
  authorId: string;
  postType: 'video' | 'vlog';
  title: string;
  body: string;
  hashtags: string[];
  isVerified: boolean;
  /** Chỉ số trong danh sách bài video, để gán xoay vòng video mẫu. */
  videoIndex: number | null;
  destination: { placeId: string; name: string } | null;
  createdAt: Date;
  updatedAt: Date;
}
export interface ConvertedEvent {
  stream: StreamName;
  envelope: EventEnvelope;
  simEventId: string;
}
export interface Skipped {
  type: string;
  reason: string;
  count: number;
}
export interface SimDataset {
  shiftMs: number;
  simEnd: Date;
  users: SimUser[];
  follows: Array<{ followerId: string; authorId: string; followedAt: Date }>;
  posts: SimPost[];
  /** Theo thứ tự occurredAt (đã dời), giữ cả bản giao lại (eventId trùng) để thử idempotent. */
  events: ConvertedEvent[];
  skipped: Skipped[];
  duplicateEventIds: number;
}

const STREAM_OF: Record<string, StreamName> = {
  'stream:core.content': STREAMS.content,
  'stream:core.commerce': STREAMS.commerce,
  'stream:core.access': STREAMS.access,
  'stream:core.discovery': STREAMS.discovery,
};

/** Loại sự kiện hệ thống thật không phát (không có trong outbox của content/commerce, không có mapper ở discovery). */
const NOT_IN_SYSTEM: Record<string, string> = {
  'content.bookmark.updated': 'hệ thống không phát sự kiện bookmark; chỉ ghi bảng content.bookmarks',
  'commerce.product.viewed': 'hệ thống không có sự kiện xem khách sạn',
  'commerce.order.created': 'gợi ý không dùng; payload mô phỏng thiếu trường bắt buộc',
  'commerce.order.refunded': 'gợi ý không dùng; payload mô phỏng thiếu trường bắt buộc',
};

function readJsonl<T>(path: string): T[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as T);
}

const toInt = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null);
const mapUser = (v: unknown): string | null => (typeof v === 'string' && v ? simId.user(v) : null);
const mapPost = (v: unknown): string | null => (typeof v === 'string' && v ? simId.post(v) : null);
const mapComment = (v: unknown): string | null => (typeof v === 'string' && v ? simId.comment(v) : null);

/**
 * @param shiftDays số ngày dời mọi mốc thời gian lên, để ngày cuối mô phỏng gần hôm nay
 *   (bảng thô giữ 90/180 ngày, điểm hot giảm theo tuổi bài).
 */
export function loadSimDataset(dataDir: string, shiftDays: number): SimDataset {
  const shiftMs = shiftDays * DAY_MS;
  const shift = (iso: string) => new Date(Date.parse(iso) + shiftMs);
  const shiftIso = (iso: string) => shift(iso).toISOString();
  const shiftDate = (d: unknown): string | null =>
    typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(Date.parse(`${d}T00:00:00Z`) + shiftMs).toISOString().slice(0, 10) : null;

  const split = JSON.parse(readFileSync(join(dataDir, 'split.json'), 'utf8')) as { totalDays: number };
  const places = JSON.parse(readFileSync(join(dataDir, 'places.json'), 'utf8')) as RawPlace[];
  const placeName = new Map(places.map((p) => [p.id, p.name]));
  const rawEvents = readJsonl<RawEvent>(join(dataDir, 'events.jsonl'));
  const rawPosts = readJsonl<RawPost>(join(dataDir, 'posts.jsonl'));
  // users_truth: chỉ lấy id, ngày đăng ký và danh sách theo dõi (đồ thị có thật trong hệ thống). Gu, chuyến đi là đáp án.
  const rawUsers = readJsonl<RawUser>(join(dataDir, 'users_truth.jsonl'));

  // Ngày 0 của mô phỏng = ngày của sự kiện đầu tiên.
  const firstEventAt = rawEvents.reduce((m, e) => Math.min(m, Date.parse(e.occurredAt)), Infinity);
  const dayZero = Math.floor(firstEventAt / DAY_MS) * DAY_MS;
  const simEnd = new Date(dayZero + split.totalDays * DAY_MS - 1000 + shiftMs);

  const registeredAt = new Map<string, string>();
  for (const e of rawEvents) {
    if (e.type === 'access.user.registered' && typeof e.payload.userId === 'string') registeredAt.set(e.payload.userId, e.occurredAt);
  }
  const oldestPostAt = rawPosts.reduce((m, p) => Math.min(m, Date.parse(p.createdAt)), Infinity);
  const users: SimUser[] = rawUsers.map((u) => {
    const n = u.id.replace(/^usr_/, '');
    // Người đăng ký trong kỳ: lúc đăng ký. Người có từ trước: trước bài cũ nhất 1 ngày.
    const created = registeredAt.get(u.id) ?? new Date(oldestPostAt - DAY_MS).toISOString();
    return { id: simId.user(u.id), simId: u.id, email: `${u.id.toLowerCase()}@${SIM_EMAIL_DOMAIN}`, displayName: `Người dùng ${n}`, createdAt: shift(created) };
  });
  const userCreated = new Map(users.map((u) => [u.simId, u.createdAt]));
  const follows = rawUsers.flatMap((u) =>
    u.following
      .filter((f) => f !== u.id)
      .map((f) => {
        const a = userCreated.get(u.id)!.getTime();
        const b = userCreated.get(f)?.getTime() ?? a;
        return { followerId: simId.user(u.id), authorId: simId.user(f), followedAt: new Date(Math.max(a, b)) };
      }),
  );

  let videoIndex = 0;
  const posts: SimPost[] = rawPosts.map((p) => ({
    id: simId.post(p.id),
    simId: p.id,
    authorId: simId.user(p.authorId),
    postType: p.postType,
    title: p.title.slice(0, 255),
    body: p.body,
    hashtags: p.hashtags,
    isVerified: p.isVerified,
    videoIndex: p.postType === 'video' ? videoIndex++ : null,
    destination: p.placeId ? { placeId: p.placeId, name: placeName.get(p.placeId) ?? p.placeId } : null,
    createdAt: shift(p.createdAt),
    updatedAt: shift(p.updatedAt),
  }));
  const postType = new Map(rawPosts.map((p) => [p.id, p.postType]));
  const userName = new Map(users.map((u) => [u.simId, u.displayName]));

  const paidTotal = new Map<string, number>();
  for (const e of rawEvents) {
    if (e.type === 'commerce.order.paid' && typeof e.payload.orderId === 'string') paidTotal.set(e.payload.orderId, toInt(e.payload.total) ?? 1);
  }

  const skippedCount = new Map<string, Skipped>();
  const skip = (type: string, reason: string) => {
    const key = `${type}|${reason}`;
    const s = skippedCount.get(key) ?? { type, reason, count: 0 };
    s.count++;
    skippedCount.set(key, s);
  };

  const seen = new Set<string>();
  let duplicateEventIds = 0;
  const events: ConvertedEvent[] = [];
  const sorted = [...rawEvents].sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
  for (const e of sorted) {
    if (seen.has(e.eventId)) duplicateEventIds++;
    seen.add(e.eventId);
    if (NOT_IN_SYSTEM[e.type]) {
      skip(e.type, NOT_IN_SYSTEM[e.type]!);
      continue;
    }
    const stream = STREAM_OF[e.stream];
    if (!stream) {
      skip(e.type, `stream lạ ${e.stream}`);
      continue;
    }
    const payload = convertPayload(e, { shiftIso, shiftDate, postType, userName, paidTotal });
    if (!payload) {
      skip(e.type, 'loại sự kiện chưa ánh xạ');
      continue;
    }
    const actor = mapUser(e.payload.userId ?? e.payload.authorId);
    events.push({
      stream,
      simEventId: e.eventId,
      envelope: {
        // eventId mô phỏng đã là uuid; vẫn đổi qua v5 để không trùng sự kiện thật.
        eventId: simId.event(e.eventId),
        type: e.type,
        version: e.version,
        occurredAt: shiftIso(e.occurredAt),
        producer: 'sim-recommend',
        userId: actor,
        payload,
      },
    });
  }

  return { shiftMs, simEnd, users, follows, posts, events, skipped: [...skippedCount.values()], duplicateEventIds };
}

interface Ctx {
  shiftIso: (iso: string) => string;
  shiftDate: (d: unknown) => string | null;
  postType: Map<string, string>;
  userName: Map<string, string>;
  paidTotal: Map<string, number>;
}

/**
 * Payload mô phỏng → đúng schema thật (libs/contracts + schema tạm trong to-raw-rows). Trường thiếu thì giữ thiếu:
 * payload sai thì hệ thống thật bỏ qua, mình cũng để nó bị bỏ qua và đếm, không tự "sửa" cho đẹp số.
 */
function convertPayload(e: RawEvent, ctx: Ctx): Json | null {
  const p = e.payload;
  switch (e.type) {
    case 'content.reaction.updated':
      return { postId: mapPost(p.postId), userId: mapUser(p.userId), type: p.type ?? null, reactionTotal: p.reactionTotal, reactionCounts: p.reactionCounts };
    case 'content.post.shared':
      return { postId: mapPost(p.postId), userId: mapUser(p.userId), shareUrl: p.shareUrl };
    case 'content.post.published':
      return { postId: mapPost(p.postId), authorId: mapUser(p.authorId), postType: ctx.postType.get(String(p.postId)) ?? null };
    case 'content.post.deleted':
    case 'content.post.moderated':
      return { postId: mapPost(p.postId), authorId: mapUser(p.authorId) };
    case 'content.comment_reaction.updated':
      // Mô phỏng ghi type ('like'); hệ thống ghi isLiked.
      return { commentId: mapComment(p.commentId), postId: mapPost(p.postId), userId: mapUser(p.userId), isLiked: p.type != null };
    case 'content.comment.created':
      return {
        commentId: mapComment(p.commentId),
        postId: mapPost(p.postId),
        postAuthorId: mapUser(p.postAuthorId),
        authorId: mapUser(p.authorId),
        parentCommentId: mapComment(p.parentCommentId),
        body: p.body,
        createdAt: typeof p.createdAt === 'string' ? ctx.shiftIso(p.createdAt) : null,
      };
    case 'content.comment.deleted':
      return {
        commentId: mapComment(p.commentId),
        postId: mapPost(p.postId),
        authorId: mapUser(p.authorId),
        parentCommentId: mapComment(p.parentCommentId),
        deletedBy: mapUser(p.deletedBy),
        isSuperAdmin: p.isSuperAdmin === true,
        deletedAt: typeof p.deletedAt === 'string' ? ctx.shiftIso(p.deletedAt) : null,
      };
    case 'commerce.order.paid':
      return {
        orderId: simId.order(String(p.orderId)),
        userId: mapUser(p.userId),
        total: toInt(p.total),
        sourcePostId: mapPost(p.sourcePostId),
        // productId giữ nguyên: khách sạn mô phỏng không khớp catalog seed (0/3.910 id trùng).
        items: (Array.isArray(p.items) ? (p.items as Json[]) : []).map((i) => ({ ...i, date: ctx.shiftDate(i.date) ?? i.date })),
      };
    case 'commerce.order.cancelled':
      return {
        orderId: simId.order(String(p.orderId)),
        userId: mapUser(p.userId),
        total: ctx.paidTotal.get(String(p.orderId)) ?? 1,
        refundAmount: 0,
        feeAmount: 0,
        confirmationCode: null,
        contactName: null,
        contactEmail: null,
      };
    case 'access.user.registered':
      return { userId: mapUser(p.userId), displayName: ctx.userName.get(String(p.userId)) ?? 'Người dùng' };
    case 'access.user.guest_merged':
      return { userId: mapUser(p.userId), anonId: typeof p.anonId === 'string' ? simId.anon(p.anonId) : null };
    case 'discovery.search.performed':
      return {
        userId: mapUser(p.userId),
        surface: 'explore',
        placeIds: typeof p.placeId === 'string' ? [p.placeId] : [],
        intent: typeof p.intent === 'string' ? p.intent : null,
        budgetMax: toInt(p.budgetMax),
        postType: null,
        resultCount: 0,
      };
    case 'discovery.stays.searched':
      return {
        userId: mapUser(p.userId),
        placeId: p.placeId,
        checkIn: ctx.shiftDate(p.dateFrom),
        checkOut: ctx.shiftDate(p.dateTo),
        adults: toInt(p.guests) ?? 1,
        rooms: null,
        minStars: null,
        priceMax: toInt(p.budgetMax),
        resultCount: 0,
      };
    default:
      return null;
  }
}

/** Trạng thái cuối của content sau khi chạy hết sự kiện (bảng reactions, bookmarks, comments, số đếm, bài bị xoá/ẩn). */
export interface ContentState {
  reactions: Array<{ id: string; postId: string; userId: string; type: string; at: Date }>;
  bookmarks: Array<{ id: string; postId: string; userId: string; at: Date }>;
  comments: Array<{ id: string; postId: string; authorId: string; parentCommentId: string | null; body: string; at: Date }>;
  shares: Map<string, number>;
  postStatus: Map<string, { status: 'deleted' | 'hidden'; at: Date }>;
}

export function contentStateOf(dataDir: string, shiftMs: number): ContentState {
  const rawEvents = readJsonl<RawEvent>(join(dataDir, 'events.jsonl')).sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
  const at = (iso: string) => new Date(Date.parse(iso) + shiftMs);
  const reaction = new Map<string, { postId: string; userId: string; type: string | null; at: Date }>();
  const bookmark = new Map<string, { postId: string; userId: string; on: boolean; at: Date }>();
  const comment = new Map<string, { postId: string; authorId: string; parentCommentId: string | null; body: string; at: Date } | null>();
  const shares = new Map<string, number>();
  const postStatus = new Map<string, { status: 'deleted' | 'hidden'; at: Date }>();
  for (const e of rawEvents) {
    const p = e.payload;
    const postId = typeof p.postId === 'string' ? p.postId : null;
    const userId = typeof p.userId === 'string' ? p.userId : null;
    switch (e.type) {
      case 'content.reaction.updated':
        if (postId && userId) reaction.set(`${postId}|${userId}`, { postId, userId, type: (p.type as string | null) ?? null, at: at(e.occurredAt) });
        break;
      case 'content.bookmark.updated':
        if (postId && userId) bookmark.set(`${postId}|${userId}`, { postId, userId, on: p.isBookmarked === true, at: at(e.occurredAt) });
        break;
      case 'content.comment.created':
        if (postId && typeof p.commentId === 'string' && !comment.has(p.commentId))
          comment.set(p.commentId, {
            postId,
            authorId: String(p.authorId),
            parentCommentId: typeof p.parentCommentId === 'string' ? p.parentCommentId : null,
            body: typeof p.body === 'string' ? p.body : '',
            at: at(e.occurredAt),
          });
        break;
      case 'content.comment.deleted':
        if (typeof p.commentId === 'string') comment.set(p.commentId, null);
        break;
      case 'content.post.shared':
        if (postId) shares.set(postId, (shares.get(postId) ?? 0) + 1);
        break;
      case 'content.post.deleted':
        if (postId) postStatus.set(postId, { status: 'deleted', at: at(e.occurredAt) });
        break;
      case 'content.post.moderated':
        if (postId && postStatus.get(postId)?.status !== 'deleted') postStatus.set(postId, { status: 'hidden', at: at(e.occurredAt) });
        break;
    }
  }
  const sim = (m: Map<string, number>) => new Map([...m].map(([k, v]) => [simId.post(k), v]));
  const status = new Map([...postStatus].map(([k, v]) => [simId.post(k), v]));
  return {
    reactions: [...reaction.values()]
      .filter((r) => r.type)
      .map((r) => ({ id: simId.row('reaction', r.postId, r.userId), postId: simId.post(r.postId), userId: simId.user(r.userId), type: r.type!, at: r.at })),
    bookmarks: [...bookmark.values()]
      .filter((b) => b.on)
      .map((b) => ({ id: simId.row('bookmark', b.postId, b.userId), postId: simId.post(b.postId), userId: simId.user(b.userId), at: b.at })),
    comments: [...comment.entries()]
      // Trả lời của bình luận đã xoá cũng bỏ, để không có parent trỏ vào dòng không tồn tại.
      .filter(([, c]) => c && (!c.parentCommentId || comment.get(c.parentCommentId)))
      .map(([id, c]) => ({
        id: simId.comment(id),
        postId: simId.post(c!.postId),
        authorId: simId.user(c!.authorId),
        parentCommentId: c!.parentCommentId ? simId.comment(c!.parentCommentId) : null,
        body: c!.body,
        at: c!.at,
      })),
    shares: sim(shares),
    postStatus: status,
  };
}
