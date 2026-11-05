import { existsSync, readFileSync } from 'node:fs';
import type { Db } from '@tripflix/db';
import { eq, sql } from 'drizzle-orm';
import { properties, reviews } from '../schema/index.js';

/** Đánh giá giả lập cho demo (sinh tất định từ catalog.json). Không phải đánh giá của người thật. */
interface ReviewSeed {
  reviews: {
    id: string;
    propertyId: string;
    roomTypeId: string | null;
    authorName: string;
    rating: number;
    title: string | null;
    body: string;
    tags: string[];
    travelerType: string | null;
    stayMonth: string | null;
    createdAt: string;
    images: string[];
    helpfulCount: number;
  }[];
  /** Tóm tắt ý kiến khách theo id khách sạn. */
  summaries: Record<string, string>;
}

export const REVIEW_SEED_FILE = 'src/modules/commerce/db/seed/reviews.json';
const BATCH = 500;

/**
 * Nạp đánh giá demo trong transaction của seed danh mục (gọi sau khi đã có khách sạn và loại phòng). Chạy lại được:
 * đánh giá cùng id thì ghi đè. Chỉ đụng dòng is_seeded, không đụng đánh giá thật. Chưa có file thì bỏ qua.
 */
export async function seedReviews(tx: Pick<Db, 'insert' | 'update'>, toImageKey: (sourcePath: string) => string, file = REVIEW_SEED_FILE): Promise<number> {
  if (!existsSync(file)) return 0;
  const seed = JSON.parse(readFileSync(file, 'utf8')) as ReviewSeed;
  const rows = seed.reviews.map((r) => ({ ...r, createdAt: new Date(r.createdAt), images: r.images.map(toImageKey), isSeeded: true, status: 'published' }));
  for (let i = 0; i < rows.length; i += BATCH) {
    await tx
      .insert(reviews)
      .values(rows.slice(i, i + BATCH))
      .onConflictDoUpdate({
        target: reviews.id,
        set: {
          roomTypeId: sql`excluded.room_type_id`,
          authorName: sql`excluded.author_name`,
          rating: sql`excluded.rating`,
          title: sql`excluded.title`,
          body: sql`excluded.body`,
          tags: sql`excluded.tags`,
          images: sql`excluded.images`,
          travelerType: sql`excluded.traveler_type`,
          stayMonth: sql`excluded.stay_month`,
          helpfulCount: sql`excluded.helpful_count`,
          createdAt: sql`excluded.created_at`,
          updatedAt: sql`now()`,
        },
        setWhere: sql`${reviews.isSeeded}`,
      });
  }
  for (const [propertyId, summary] of Object.entries(seed.summaries)) {
    await tx
      .update(properties)
      .set({ details: sql`${properties.details} || ${JSON.stringify({ reviewSummary: summary })}::jsonb` })
      .where(eq(properties.id, propertyId));
  }
  return rows.length;
}
