import { z } from 'zod';
import { assignBins } from '../bins.js';
import { round4, type Kind, type PostMeta, type UserBuilder } from '../contracts.js';

/**
 * trip_profile@v1 (TF28 v1): câu trả lời DÀI HẠN của người dùng, mỗi câu hỏi một histogram trên ngăn.
 * H1b thường thích nơi nào → answers.place · H2 thích làm gì → answers.exp · H3/H4/H5 dài hạn → cost/with/len · H6 → creators.
 * Chỉ tương tác lên bài mới trả lời các câu này. Tìm kiếm, xem khách sạn là "đang tìm hiểu": tính lúc gọi (live-answers.ts),
 * không cộng vào đây, để 200 lượt tìm Hà Nội không đè gu.
 * Muốn đổi trọng số / thời gian nhạt dần: sửa hai hằng dưới, tăng version nếu đổi hình dạng features.
 */
const INTEREST_KINDS: Partial<Record<Kind, number>> = { order_item: 5, bookmark: 4, share: 4, comment: 3, reaction: 2 };
const HALF_LIFE_DAYS = 14;

export const TripProfileV1FeaturesSchema = z.object({
  /** câu hỏi ('place', 'exp', 'cost', 'with', 'len', 'season') → ngăn → tổng trọng số (chưa chuẩn hoá: ranker lấy cosine). */
  answers: z.record(z.string(), z.record(z.string(), z.number())),
  /** câu hỏi → tổng trọng số dấu hiệu, để ranker tính độ tin (cosine bỏ mất độ lớn). */
  evidence: z.record(z.string(), z.number()),
  creators: z.record(z.string(), z.number()),
  interactionCount: z.number(),
});
export type TripProfileV1Features = z.infer<typeof TripProfileV1FeaturesSchema>;

const question = (bin: string) => bin.slice(0, bin.indexOf(':'));

/** Bài mà một dòng nói tới: thả tim/lưu/... lên bài, hoặc đơn đặt từ bài (sourcePostId). */
function postOf(row: { targetType: string | null; targetId: string | null; detail: Record<string, unknown> | null }, posts: Record<string, PostMeta>) {
  if (row.targetType === 'post' && row.targetId) return posts[row.targetId];
  const source = row.detail?.sourcePostId;
  return typeof source === 'string' ? posts[source] : undefined;
}

export const tripProfileV1: UserBuilder = {
  key: 'trip_profile@v1',
  featuresSchema: TripProfileV1FeaturesSchema,
  build(items, now) {
    return Promise.resolve(
      items.map((item) => {
        const answers: Record<string, Record<string, number>> = {};
        const evidence: Record<string, number> = {};
        const creators: Record<string, number> = {};
        const active = item.rows.filter((r) => !r.isRemoved);
        for (const row of active) {
          const wKind = INTEREST_KINDS[row.kind];
          const post = wKind ? postOf(row, item.posts) : undefined;
          if (!wKind || !post) continue;
          const ageDays = Math.max(0, (now.getTime() - Date.parse(row.occurredAt)) / 86_400_000);
          const w = wKind * 0.5 ** (ageDays / HALF_LIFE_DAYS);
          const touched = new Set<string>();
          for (const [bin, binW] of Object.entries(assignBins(post))) {
            const q = question(bin);
            (answers[q] ??= {})[bin] = (answers[q][bin] ?? 0) + w * binW;
            touched.add(q);
          }
          for (const q of touched) evidence[q] = (evidence[q] ?? 0) + w;
          creators[post.authorId] = (creators[post.authorId] ?? 0) + w;
        }
        const roundAll = (m: Record<string, number>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, round4(v)]));
        const features: TripProfileV1Features = {
          answers: Object.fromEntries(Object.entries(answers).map(([q, m]) => [q, roundAll(m)])),
          evidence: roundAll(evidence),
          creators: roundAll(creators),
          interactionCount: active.length,
        };
        return { userId: item.userId, features };
      }),
    );
  },
};
