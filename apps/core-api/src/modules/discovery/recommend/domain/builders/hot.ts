import { z } from 'zod';
import { round4, type PostBuilder } from '../contracts.js';

export const HotV0FeaturesSchema = z.object({
  reactions: z.number(),
  comments: z.number(),
  shares: z.number(),
  bookmarks: z.number(),
  velocity24h: z.number(),
  ageHours: z.number(),
});

/** Phân vị kiểu numpy.percentile (nội suy tuyến tính), để khớp thử nghiệm Python. */
export function percentile(values: readonly number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

/**
 * hot@v0: raw = log1p(r + 3c + 4b + 5s) / (giờTuổi + 2)^1.2, score = min(1, raw / p99 của cả lô).
 * Đối chiếu experiments/recommend/rec/builders/post_hot_v0.py. Công thức giữ chỗ, chưa tinh chỉnh.
 */
export const hotV0: PostBuilder = {
  key: 'hot@v0',
  featuresSchema: HotV0FeaturesSchema,
  build(items, now) {
    const rows = items.map((item) => {
      const ageHours = Math.max(0, (now.getTime() - Date.parse(item.publishedAt)) / 3_600_000);
      const reactions = item.interactions.reaction ?? 0;
      const comments = item.interactions.comment ?? 0;
      const bookmarks = item.interactions.bookmark ?? 0;
      const shares = item.interactions.share ?? 0;
      const velocity24h = Object.values(item.interactions24h).reduce((sum, n) => sum + (n ?? 0), 0);
      const raw = Math.log1p(reactions + 3 * comments + 4 * bookmarks + 5 * shares) / (ageHours + 2) ** 1.2;
      return { postId: item.postId, raw, features: { reactions, comments, shares, bookmarks, velocity24h, ageHours: Math.round(ageHours * 100) / 100 } };
    });
    const p99 = percentile(rows.map((r) => r.raw), 99);
    return Promise.resolve(
      rows.map((r) => ({ postId: r.postId, score: p99 > 0 ? round4(Math.min(1, Math.max(0, r.raw / p99))) : 0, features: r.features })),
    );
  },
};
