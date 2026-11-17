import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CATALOG_SEED_FILE } from '../../../../commerce/db/seed/seed-catalog.js';
import type { ReelCatalogFlight, ReelCatalogHotel, ReelVideo } from './generate-reels.js';
import { buildReelSeed, REEL_VIDEOS_FILE } from './reel-seed.js';

const catalog = JSON.parse(readFileSync(CATALOG_SEED_FILE, 'utf8')) as { hotels: ReelCatalogHotel[]; flights: ReelCatalogFlight[] };
const videos = JSON.parse(readFileSync(REEL_VIDEOS_FILE, 'utf8')) as ReelVideo[];
const authorIds = Array.from({ length: 200 }, (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const seed = buildReelSeed({ authorIds, hotels: catalog.hotels, flights: catalog.flights });
const hotelsById = new Map(catalog.hotels.map((h) => [h.id, h]));
const routes = new Set(catalog.flights.map((f) => `${f.fromAirport}-${f.toAirport}`));

describe('reel mẫu sinh từ các video mẫu', () => {
  it('đủ 1000 bài reel, 400 bài có lộ trình, mỗi bài một video riêng của chính người đăng', () => {
    expect(seed.posts).toHaveLength(1000);
    expect(seed.posts.filter((p) => p.tripAttachment)).toHaveLength(400);
    const media = new Map(seed.mediaAssets.map((m) => [m.id, m]));
    const hlsPrefixes = new Set(videos.map((v) => v.media.hlsPrefix));
    for (const post of seed.posts) {
      expect(post).toMatchObject({ postType: 'video', status: 'published', visibility: 'public', isVerified: false });
      expect(post.mediaIds).toHaveLength(1);
      const asset = media.get(post.mediaIds[0]!)!;
      expect(asset.ownerId).toBe(post.authorId);
      expect(hlsPrefixes.has(asset.hlsPrefix)).toBe(true);
    }
    expect(new Set(seed.mediaAssets.map((m) => m.hlsPrefix)).size).toBe(videos.length);
  });

  it('tiêu đề và nội dung không bài nào trùng nhau', () => {
    expect(new Set(seed.posts.map((p) => p.title)).size).toBe(1000);
    expect(new Set(seed.posts.map((p) => p.body)).size).toBe(1000);
    expect(seed.posts.every((p) => p.title.length <= 255 && p.hashtags.length >= 3)).toBe(true);
  });

  it('chia cho đủ 200 tài khoản, hai bài cùng video không đứng sát nhau trên feed', () => {
    expect(new Set(seed.posts.map((p) => p.authorId)).size).toBe(200);
    const lastIndex = new Map<string, number>();
    let minGap = Infinity;
    seed.posts.forEach((post, i) => {
      const prefix = seed.mediaAssets[i]!.hlsPrefix;
      if (lastIndex.has(prefix)) minGap = Math.min(minGap, i - lastIndex.get(prefix)!);
      lastIndex.set(prefix, i);
    });
    expect(minGap).toBeGreaterThanOrEqual(15);
  });

  it('lộ trình có 1–5 điểm đặt được, khách sạn và chuyến bay đều có thật trong catalog', () => {
    const bookableCounts = new Set<number>();
    for (const post of seed.posts.filter((p) => p.tripAttachment)) {
      const items = post.tripAttachment!.items!;
      const hotels = items.filter((item) => item.hotel);
      const flights = items.filter((item) => item.transport?.mode === 'flight');
      const bookable = hotels.length + flights.length;
      bookableCounts.add(bookable);
      expect(bookable).toBeGreaterThanOrEqual(1);
      expect(bookable).toBeLessThanOrEqual(5);
      for (const { hotel } of hotels) {
        const found = hotelsById.get(hotel!.hotelId)!;
        const roomType = found.roomTypes.find((r) => r.id === hotel!.productId)!;
        expect(roomType.ratePlans.some((r) => r.code === hotel!.ratePlanCode)).toBe(true);
      }
      for (const { transport } of flights) expect(routes.has(`${transport!.fromAirport}-${transport!.toAirport}`)).toBe(true);
      // Có quán ăn, cà phê hoặc chỗ chơi xen giữa, các điểm này không gắn khách sạn hay chuyến bay.
      const stops = items.filter((item) => !item.hotel && !item.transport);
      expect(stops.length).toBeGreaterThan(0);
      expect(post.tripAttachment!.hotelId).toBe(hotels[0]!.hotel!.hotelId);
      expect(post.tripAttachment!.bookingId).toBeUndefined();
      expect(post.tripAttachment!.daysCount).toBeGreaterThanOrEqual(Math.max(...items.map((i) => i.day)));
    }
    expect([...bookableCounts].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });

  it('cảm xúc, bookmark, bình luận khớp số đếm và không tự tương tác bài của mình', () => {
    const posts = new Map(seed.posts.map((p) => [p.id, p]));
    const reactionKeys = new Set(seed.reactions.map((r) => `${r.postId}:${r.userId}`));
    expect(reactionKeys.size).toBe(seed.reactions.length);
    expect(new Set(seed.bookmarks.map((b) => `${b.postId}:${b.userId}`)).size).toBe(seed.bookmarks.length);
    for (const r of seed.reactions) expect(r.userId).not.toBe(posts.get(r.postId)!.authorId);
    for (const post of seed.posts) {
      expect(seed.reactions.filter((r) => r.postId === post.id)).toHaveLength(post.reactionTotal);
      expect(seed.bookmarks.filter((b) => b.postId === post.id)).toHaveLength(post.bookmarkCount);
      expect(seed.comments.filter((c) => c.postId === post.id)).toHaveLength(post.commentCount);
    }
    const commentIds = new Map(seed.comments.map((c) => [c.id, c]));
    for (const c of seed.comments) if (c.parentCommentId) expect(commentIds.get(c.parentCommentId)!.postId).toBe(c.postId);
  });

  it('chạy lại ra đúng dữ liệu cũ', () => {
    expect(buildReelSeed({ authorIds, hotels: catalog.hotels, flights: catalog.flights })).toEqual(seed);
  });
});
