import { readFileSync } from 'node:fs';
import type { Db } from '@tripflix/db';
import { eq, sql } from 'drizzle-orm';
import { properties, reviews } from '../schema/index.js';
import { generateReviews, type CatalogHotelForReviews, type ReviewPhoto } from './generate-reviews.js';

/** Ảnh đánh giá kiểu khách tự chụp (Unsplash, Pexels, Wikimedia Commons), kèm nguồn, tác giả, giấy phép. File ảnh nằm ở <S3_KEY_PREFIX>images/hotels/reviews/. */
export const REVIEW_PHOTOS_FILE = 'src/modules/commerce/db/seed/review-photos.json';
const BATCH = 1000;

export function loadReviewPhotos(file = REVIEW_PHOTOS_FILE): ReviewPhoto[] {
  return JSON.parse(readFileSync(file, 'utf8')) as ReviewPhoto[];
}

/**
 * Nạp đánh giá demo trong transaction của seed danh mục (gọi sau khi đã có khách sạn và loại phòng). Đánh giá sinh
 * tất định từ danh mục lúc seed (khoảng 53.000 dòng, không lưu sẵn file). Chạy lại được: xoá đánh giá demo cũ
 * (is_seeded) rồi nạp lại, nên bộ sinh đổi số lượng cũng không để sót dòng cũ; không đụng đánh giá thật.
 */
export async function seedReviews(
  tx: Pick<Db, 'insert' | 'update' | 'delete'>,
  hotels: CatalogHotelForReviews[],
  toImageKey: (sourcePath: string) => string,
  photos: ReviewPhoto[] = loadReviewPhotos(),
): Promise<number> {
  const generated = generateReviews(hotels, photos);
  await tx.delete(reviews).where(eq(reviews.isSeeded, true));
  const rows = generated.reviews.map((r) => ({ ...r, createdAt: new Date(r.createdAt), images: r.images.map(toImageKey), isSeeded: true, status: 'published' }));
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
  for (const [propertyId, summary] of Object.entries(generated.summaries)) {
    // Điểm và số đánh giá ở đầu trang lấy đúng theo đánh giá trong hệ thống, để khớp với phần đánh giá bên dưới.
    // Điểm TripAdvisor/Google trong catalog chỉ dùng làm mức điểm mục tiêu khi sinh, nên bỏ nguồn ngoài.
    const stat = generated.stats[propertyId]!;
    await tx
      .update(properties)
      .set({
        details: sql`${properties.details} || ${JSON.stringify({ reviewSummary: summary })}::jsonb`,
        reviewCount: stat.count,
        ratingAvg: stat.avg,
        ratingSource: null,
      })
      .where(eq(properties.id, propertyId));
  }
  return rows.length;
}
