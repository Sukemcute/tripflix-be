import { readFileSync } from 'node:fs';
import type { Db } from '@tripflix/db';
import { sql } from 'drizzle-orm';
import { seedContentData, type ContentSeed } from '../seed-content.js';
import {
  generateReelSeed,
  reelSeedId,
  type ReelCatalogFlight,
  type ReelCatalogHotel,
  type ReelStops,
  type ReelVideo,
} from './generate-reels.js';

export const REEL_VIDEOS_FILE = 'src/modules/content/db/seed/reels/reel-videos.json';
export const REEL_STOPS_FILE = 'src/modules/content/db/seed/reels/reel-stops.json';
/** Mốc cố định để chạy lại ra đúng dữ liệu cũ (ngày đăng rải 120 ngày trước mốc này). */
export const REEL_SEED_NOW = new Date('2026-11-17T12:00:00+07:00');

/** Đọc 60 video và điểm dừng rồi sinh 1000 reel mẫu cho các tài khoản authorIds. */
export function buildReelSeed(input: {
  authorIds: string[];
  hotels: ReelCatalogHotel[];
  flights: ReelCatalogFlight[];
}): ContentSeed {
  return generateReelSeed({
    videos: JSON.parse(readFileSync(REEL_VIDEOS_FILE, 'utf8')) as ReelVideo[],
    stops: JSON.parse(readFileSync(REEL_STOPS_FILE, 'utf8')) as ReelStops,
    hotels: input.hotels,
    flights: input.flights,
    authorIds: input.authorIds,
    now: REEL_SEED_NOW,
  });
}

/**
 * Nạp reel mẫu, chạy lại được kể cả khi dữ liệu sinh đã đổi (thêm video, sửa bộ sinh):
 * xoá cảm xúc, bookmark, bình luận mẫu cũ theo dải id của seed (không đụng tương tác của người dùng thật),
 * nạp lại, rồi đặt lại người đăng và chủ video vì upsert bài không ghi đè author_id, owner_id.
 */
export async function seedReels(db: Db, seed: ContentSeed): Promise<Awaited<ReturnType<typeof seedContentData>>> {
  const range = (group: 'comment' | 'reaction' | 'bookmark') => sql`BETWEEN ${reelSeedId(group, 0)} AND ${reelSeedId(group, 0xffffffffffff)}`;
  await db.transaction(async (tx) => {
    await tx.execute(sql`DELETE FROM content.reactions WHERE id ${range('reaction')}`);
    await tx.execute(sql`DELETE FROM content.bookmarks WHERE id ${range('bookmark')}`);
    await tx.execute(sql`DELETE FROM content.comments WHERE id ${range('comment')}`);
  });
  const stats = await seedContentData(db, seed);
  const authors = sql.join(seed.posts.map((p) => sql`(${p.id}::uuid, ${p.authorId}::uuid, ${p.mediaIds[0]}::uuid)`), sql`, `);
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`UPDATE content.posts p SET author_id = v.author_id FROM (VALUES ${authors}) AS v(post_id, author_id, media_id) WHERE p.id = v.post_id AND p.author_id <> v.author_id`,
    );
    await tx.execute(
      sql`UPDATE content.media_assets m SET owner_id = v.author_id FROM (VALUES ${authors}) AS v(post_id, author_id, media_id) WHERE m.id = v.media_id AND m.owner_id <> v.author_id`,
    );
  });
  return stats;
}
