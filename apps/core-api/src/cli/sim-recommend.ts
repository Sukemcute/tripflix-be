import { Logger } from '@nestjs/common';
import { createDb, createPool, type Db } from '@tripflix/db';
import { RedisStreamsEventBus } from '@tripflix/event-bus';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { z } from 'zod';
import { Argon2PasswordHasher } from '../modules/access/auth/infra/argon2-password-hasher.js';
import { users } from '../modules/access/db/schema/index.js';
import { bookmarks, comments, follows, mediaAssets, posts, reactions } from '../modules/content/db/schema/index.js';
import { RecommendIngestUseCases } from '../modules/discovery/recommend/application/ingest.use-cases.js';
import type { RecentPostsStore } from '../modules/discovery/recommend/application/ports.js';
import { recommendInteractions } from '../modules/discovery/db/schema/recommend.js';
import { toRawRows } from '../modules/discovery/recommend/domain/ingest/to-raw-rows.js';
import { DrizzleRecommendStore } from '../modules/discovery/recommend/infra/drizzle-recommend.store.js';
import { contentStateOf, loadSimDataset, type ConvertedEvent, type SimDataset } from './sim-recommend/convert.js';

/**
 * Nạp bộ dữ liệu mô phỏng gợi ý (bộ sinh v2 của Duy) vào hệ thống (TF107).
 *
 *   node dist/cli/sim-recommend.js plan        --data <thư mục>                 chỉ đếm, không ghi
 *   node dist/cli/sim-recommend.js seed-state  --data <thư mục> --yes           người dùng, bài, theo dõi, cảm xúc, lưu, bình luận
 *   node dist/cli/sim-recommend.js replay      --data <thư mục> --per-type 3 --yes   phát thử vào stream, consumer thật nạp
 *   node dist/cli/sim-recommend.js ingest      --data <thư mục> --yes           nạp hàng loạt bằng RecommendIngestUseCases
 *
 * Chạy lại không tạo trùng (uuid v5 cố định + ON CONFLICT). Không chạy ở production.
 */

const EnvSchema = z.object({
  NODE_ENV: z.string().default('development'),
  DATABASE_URL_ACCESS: z.string().min(1),
  DATABASE_URL_CONTENT: z.string().min(1),
  DATABASE_URL_DISCOVERY: z.string().min(1),
  REDIS_URL: z.string().min(1),
  SEED_PASSWORD: z.string().min(8, 'cần ít nhất 8 ký tự'),
});
const ArgsSchema = z.object({
  command: z.enum(['plan', 'seed-state', 'replay', 'ingest']),
  data: z.string().min(1, 'thiếu --data <thư mục dữ liệu>'),
  shiftDays: z.coerce.number().int().min(0).max(3650),
  perType: z.coerce.number().int().min(1).max(50),
  isConfirmed: z.boolean(),
});
type Args = z.infer<typeof ArgsSchema>;

const CHUNK = 1_000;
const VIDEO_SAMPLES = 10;
const REPLAY_WAIT_MS = 15_000;
const out = (line: string) => process.stdout.write(`${line}\n`);

function parseArgs(argv: string[]): Args {
  const flag = (name: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return ArgsSchema.parse({
    command: argv[0],
    data: flag('data'),
    // Ngày cuối mô phỏng 10/11/2026 → mặc định dời tới gần hôm nạp; truyền --shift-days để đổi.
    shiftDays: flag('shift-days') ?? defaultShiftDays(),
    perType: flag('per-type') ?? 3,
    isConfirmed: argv.includes('--yes'),
  });
}

function defaultShiftDays(): number {
  const simEnd = Date.parse('2026-11-10T23:59:59Z');
  return Math.max(0, Math.floor((Date.now() - simEnd) / 86_400_000));
}

function targetOf(url: string): string {
  const u = new URL(url);
  return `${u.hostname}:${u.port || '5432'}${u.pathname}`;
}

function chunks<T>(rows: T[], size = CHUNK): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < rows.length; i += size) result.push(rows.slice(i, i + size));
  return result;
}

function printPlan(ds: SimDataset): void {
  const byType = new Map<string, number>();
  for (const e of ds.events) byType.set(e.envelope.type, (byType.get(e.envelope.type) ?? 0) + 1);
  let rows = 0;
  let invalid = 0;
  const invalidByType = new Map<string, number>();
  for (const e of ds.events) {
    const r = toRawRows(e.envelope);
    if (r === null) {
      invalid++;
      invalidByType.set(e.envelope.type, (invalidByType.get(e.envelope.type) ?? 0) + 1);
    } else rows += r.length;
  }
  out(`Dời mốc thời gian: ${ds.shiftMs / 86_400_000} ngày, ngày cuối mô phỏng thành ${ds.simEnd.toISOString()}`);
  out(`Người dùng: ${ds.users.length} · theo dõi: ${ds.follows.length} · bài: ${ds.posts.length} (video ${ds.posts.filter((p) => p.postType === 'video').length})`);
  out(`Sự kiện chuyển được: ${ds.events.length} (eventId trùng, giữ để thử idempotent: ${ds.duplicateEventIds})`);
  for (const [type, n] of [...byType].sort((a, b) => b[1] - a[1])) out(`  ${type}: ${n}`);
  out(`Sự kiện bỏ (hệ thống không có): ${ds.skipped.reduce((s, x) => s + x.count, 0)}`);
  for (const s of ds.skipped) out(`  ${s.type}: ${s.count} — ${s.reason}`);
  out(`Theo toRawRows thật: ${rows} dòng thô (tính cả bản giao lại), ${invalid} sự kiện sai schema bị bỏ`);
  for (const [type, n] of invalidByType) out(`  sai schema ${type}: ${n}`);
}

async function seedState(ds: SimDataset, args: Args, env: z.infer<typeof EnvSchema>): Promise<void> {
  const state = contentStateOf(args.data, ds.shiftMs);
  const accessPool = createPool({ url: env.DATABASE_URL_ACCESS, max: 2, applicationName: 'sim-recommend:access' });
  const contentPool = createPool({ url: env.DATABASE_URL_CONTENT, max: 2, applicationName: 'sim-recommend:content' });
  try {
    const accessDb = createDb(accessPool);
    const contentDb = createDb(contentPool);
    // Một mật khẩu chung (SEED_PASSWORD) để Duy/Bảo đăng nhập vai bất kỳ người dùng mô phỏng; hash một lần cho nhanh.
    const passwordHash = await new Argon2PasswordHasher().hash(env.SEED_PASSWORD);
    let n = 0;
    for (const part of chunks(ds.users)) {
      const inserted = await accessDb
        .insert(users)
        .values(
          part.map((u) => ({
            id: u.id,
            email: u.email,
            passwordHash,
            displayName: u.displayName,
            role: 'member' as const,
            status: 'active' as const,
            emailVerifiedAt: u.createdAt,
            createdAt: u.createdAt,
            updatedAt: u.createdAt,
          })),
        )
        .onConflictDoNothing()
        .returning({ id: users.id });
      n += inserted.length;
    }
    out(`access.users: thêm ${n}/${ds.users.length}`);

    const videos = await contentDb
      .select({ id: mediaAssets.id })
      .from(mediaAssets)
      .where(and(eq(mediaAssets.kind, 'video'), eq(mediaAssets.status, 'ready')))
      .orderBy(mediaAssets.id)
      .limit(VIDEO_SAMPLES);
    if (videos.length === 0) throw new Error('Không có video mẫu sẵn sàng trong content.media_assets (chạy db:seed trước)');

    const reactionCounts = new Map<string, Record<string, number>>();
    for (const r of state.reactions) {
      const c = reactionCounts.get(r.postId) ?? {};
      c[r.type] = (c[r.type] ?? 0) + 1;
      reactionCounts.set(r.postId, c);
    }
    const count = <T extends { postId: string }>(rows: T[]) => {
      const m = new Map<string, number>();
      for (const r of rows) m.set(r.postId, (m.get(r.postId) ?? 0) + 1);
      return m;
    };
    const commentCount = count(state.comments);
    const bookmarkCount = count(state.bookmarks);

    n = 0;
    for (const part of chunks(ds.posts)) {
      const inserted = await contentDb
        .insert(posts)
        .values(
          part.map((p) => {
            const status = state.postStatus.get(p.id);
            const counts = reactionCounts.get(p.id) ?? {};
            return {
              id: p.id,
              authorId: p.authorId,
              postType: p.postType,
              title: p.title,
              body: p.body,
              hashtags: p.hashtags,
              status: status?.status ?? ('published' as const),
              visibility: 'public' as const,
              isVerified: p.isVerified,
              mediaIds: p.videoIndex === null ? [] : [videos[p.videoIndex % videos.length]!.id],
              tripAttachment: p.destination ? { destinationPlaceId: p.destination.placeId, destinationName: p.destination.name } : null,
              reactionCounts: counts,
              reactionTotal: Object.values(counts).reduce((s, v) => s + v, 0),
              commentCount: commentCount.get(p.id) ?? 0,
              shareCount: state.shares.get(p.id) ?? 0,
              bookmarkCount: bookmarkCount.get(p.id) ?? 0,
              publishedAt: p.createdAt,
              createdAt: p.createdAt,
              updatedAt: status?.at ?? p.updatedAt,
              deletedAt: status?.status === 'deleted' ? status.at : null,
            };
          }),
        )
        .onConflictDoNothing()
        .returning({ id: posts.id });
      n += inserted.length;
    }
    out(`content.posts: thêm ${n}/${ds.posts.length} (video gán xoay vòng ${videos.length} video mẫu)`);

    n = 0;
    for (const part of chunks(ds.follows)) {
      n += (await contentDb.insert(follows).values(part).onConflictDoNothing().returning({ id: follows.followerId })).length;
    }
    out(`content.follows: thêm ${n}/${ds.follows.length}`);

    n = 0;
    for (const part of chunks(state.reactions)) {
      const values = part.map((r) => ({ id: r.id, postId: r.postId, userId: r.userId, type: r.type as 'like' | 'love' | 'helpful', createdAt: r.at, updatedAt: r.at }));
      n += (await contentDb.insert(reactions).values(values).onConflictDoNothing().returning({ id: reactions.id })).length;
    }
    out(`content.reactions: thêm ${n}/${state.reactions.length}`);

    n = 0;
    for (const part of chunks(state.bookmarks)) {
      const values = part.map((b) => ({ id: b.id, postId: b.postId, userId: b.userId, createdAt: b.at }));
      n += (await contentDb.insert(bookmarks).values(values).onConflictDoNothing().returning({ id: bookmarks.id })).length;
    }
    out(`content.bookmarks: thêm ${n}/${state.bookmarks.length}`);

    n = 0;
    // Theo thời gian: bình luận gốc luôn có trước trả lời của nó.
    const sortedComments = [...state.comments].sort((a, b) => a.at.getTime() - b.at.getTime());
    for (const part of chunks(sortedComments)) {
      const values = part.map((c) => ({
        id: c.id,
        postId: c.postId,
        authorId: c.authorId,
        parentCommentId: c.parentCommentId,
        body: c.body,
        status: 'visible' as const,
        createdAt: c.at,
        updatedAt: c.at,
      }));
      n += (await contentDb.insert(comments).values(values).onConflictDoNothing().returning({ id: comments.id })).length;
    }
    out(`content.comments: thêm ${n}/${state.comments.length}`);
  } finally {
    await accessPool.end();
    await contentPool.end();
  }
}

/** Phát `perType` sự kiện đầu tiên của mỗi loại vào stream thật, rồi chờ consumer core-discovery ghi bảng thô. */
async function replay(ds: SimDataset, args: Args, env: z.infer<typeof EnvSchema>): Promise<void> {
  const picked = new Map<string, ConvertedEvent[]>();
  for (const e of ds.events) {
    const list = picked.get(e.envelope.type) ?? [];
    if (list.length < args.perType && toRawRows(e.envelope)?.length) list.push(e);
    picked.set(e.envelope.type, list);
  }
  const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2 });
  const pool = createPool({ url: env.DATABASE_URL_DISCOVERY, max: 1, applicationName: 'sim-recommend:replay' });
  try {
    const bus = new RedisStreamsEventBus(redis);
    const sent = [...picked.values()].flat();
    for (const e of sent) await bus.publish(e.stream, e.envelope);
    out(`Đã phát ${sent.length} sự kiện (${picked.size} loại), chờ consumer nạp...`);
    const db = createDb(pool);
    const ids = sent.map((e) => e.envelope.eventId);
    const deadline = Date.now() + REPLAY_WAIT_MS;
    let found: Array<{ eventId: string }> = [];
    while (Date.now() < deadline) {
      found = await db
        .selectDistinct({ eventId: recommendInteractions.sourceEventId })
        .from(recommendInteractions)
        .where(inArray(recommendInteractions.sourceEventId, ids));
      // Huỷ đơn chỉ đổi is_removed của dòng order_item cũ, không có dòng mang eventId của nó.
      if (found.length >= sent.filter((e) => e.envelope.type !== 'commerce.order.cancelled').length) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    const ok = new Set(found.map((f) => f.eventId));
    for (const [type, list] of picked) {
      const n = list.filter((e) => ok.has(e.envelope.eventId)).length;
      out(`  ${type}: ${n}/${list.length} có dòng trong recommend_interactions`);
    }
  } finally {
    redis.disconnect();
    await pool.end();
  }
}

/** Không ghi gu trong phiên (Redis, hạn 2 giờ): sự kiện mô phỏng là quá khứ, không phải phiên đang mở. */
const noRecentPosts: RecentPostsStore = { list: async () => [], record: async () => undefined };

async function ingest(ds: SimDataset, env: z.infer<typeof EnvSchema>): Promise<void> {
  const pool = createPool({ url: env.DATABASE_URL_DISCOVERY, max: 1, applicationName: 'sim-recommend:ingest' });
  try {
    const db: Db = createDb(pool);
    const useCases = new RecommendIngestUseCases(new DrizzleRecommendStore(db), noRecentPosts);
    const startedAt = Date.now();
    let invalid = 0;
    for (const [i, e] of ds.events.entries()) {
      if (toRawRows(e.envelope) === null) invalid++;
      // Theo thứ tự thời gian, từng sự kiện một, đúng như consumer: upsert chỉ ghi đè khi occurred_at mới hơn.
      await useCases.ingest(e.envelope);
      if ((i + 1) % 10_000 === 0) out(`  ${i + 1}/${ds.events.length} sự kiện`);
    }
    const [row] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(recommendInteractions);
    out(`Nạp ${ds.events.length} sự kiện trong ${Math.round((Date.now() - startedAt) / 1000)} giây; sai schema bỏ ${invalid}`);
    out(`discovery.recommend_interactions hiện có ${row?.total ?? 0} dòng`);
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const ds = loadSimDataset(args.data, args.shiftDays);
  if (args.command === 'plan') {
    printPlan(ds);
    return;
  }
  const env = EnvSchema.parse(process.env);
  if (env.NODE_ENV === 'production') throw new Error('Không nạp dữ liệu mô phỏng ở production');
  out(`Đích: DB ${targetOf(env.DATABASE_URL_CONTENT)} · Redis ${targetOf(env.REDIS_URL).replace(/\/$/, '')}`);
  if (!args.isConfirmed) {
    out('Chưa ghi gì. Kiểm đúng đích rồi chạy lại với --yes.');
    return;
  }
  // Payload sai schema là chuyện dự kiến (đếm ở plan), không cần log từng dòng.
  Logger.overrideLogger(['error']);
  if (args.command === 'seed-state') await seedState(ds, args, env);
  else if (args.command === 'replay') await replay(ds, args, env);
  else await ingest(ds, env);
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
