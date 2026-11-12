import { z } from 'zod';
import { round4, type Kind, type PostMeta, type UserBuilder } from '../contracts.js';

const WeightMapSchema = z.record(z.string(), z.number().min(0).max(1));

export const TagAffinityV0FeaturesSchema = z.object({
  tags: WeightMapSchema,
  places: WeightMapSchema,
  postTypes: WeightMapSchema,
  homePlace: z.string().nullable(),
  interactionCount: z.number().int().nonnegative(),
});
export type TagAffinityV0Features = z.infer<typeof TagAffinityV0FeaturesSchema>;

const KIND_WEIGHTS: Partial<Record<Kind, number>> = {
  order_item: 5,
  bookmark: 3,
  comment: 2,
  share: 2,
  search: 2,
  stays_search: 2,
  reaction: 1,
  view: 0.5,
};
const HALF_LIFE_DAYS = 14;
const PRODUCT_TARGETS = new Set(['room', 'stay', 'hotel', 'product']);

/** Chia cho max, sắp giảm dần; mọi trọng số trong [0, 1]. */
function normalize(scores: Map<string, number>): Record<string, number> {
  const max = Math.max(0, ...scores.values());
  if (max <= 0) return {};
  return Object.fromEntries([...scores].sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, round4(v / max)]));
}

const add = (m: Map<string, number>, key: string, w: number) => m.set(key, (m.get(key) ?? 0) + w);
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

/**
 * tag_affinity@v0: mỗi dòng không isRemoved góp w = wKind · 0.5^(ngàyTuổi/14) vào gu tag, nơi, loại bài.
 * Đối chiếu experiments/recommend/rec/builders/user_tag_affinity_v0.py (chưa lọc NOISE_TAGS: handoff không có).
 */
export const tagAffinityV0: UserBuilder = {
  key: 'tag_affinity@v0',
  featuresSchema: TagAffinityV0FeaturesSchema,
  build(items, now) {
    return Promise.resolve(
      items.map((item) => {
        const tags = new Map<string, number>();
        const places = new Map<string, number>();
        const postTypes = new Map<string, number>();
        let homePlace: string | null = null;
        const active = item.rows.filter((r) => !r.isRemoved);

        for (const row of active) {
          const ageDays = Math.max(0, (now.getTime() - Date.parse(row.occurredAt)) / 86_400_000);
          const w = (KIND_WEIGHTS[row.kind] ?? 1) * 0.5 ** (ageDays / HALF_LIFE_DAYS);
          homePlace = str(row.detail?.homePlace) ?? homePlace;

          // 1. Dòng nhắm bài, hoặc đơn đến từ một bài.
          let post: PostMeta | undefined;
          const sourcePostId = str(row.detail?.sourcePostId);
          if (row.targetType === 'post' && row.targetId) post = item.posts[row.targetId];
          else if (sourcePostId) post = item.posts[sourcePostId];
          else if (row.targetId) post = item.posts[row.targetId];
          if (post) {
            for (const t of post.tags) {
              const tag = t.trim().toLowerCase();
              if (tag) add(tags, tag, w);
            }
            if (post.placeId) add(places, post.placeId, w);
            if (post.postType) add(postTypes, post.postType.trim().toLowerCase(), w);
          }

          // 2. Tìm kiếm theo nơi.
          if (row.targetType === 'place' || row.kind === 'search' || row.kind === 'stays_search') {
            const placeId = row.targetId ?? str(row.detail?.placeId);
            if (placeId) add(places, placeId, w);
          }

          // 3. Xem / đặt phòng.
          if (row.kind === 'view' || row.kind === 'order_item' || (row.targetType && PRODUCT_TARGETS.has(row.targetType))) {
            const placeId = str(row.detail?.placeId) ?? (row.targetId ? item.productPlaces[row.targetId] : undefined);
            if (placeId) add(places, placeId, w);
          }
        }

        const features: TagAffinityV0Features = {
          tags: normalize(tags),
          places: normalize(places),
          postTypes: normalize(postTypes),
          homePlace,
          interactionCount: active.length,
        };
        return { userId: item.userId, features };
      }),
    );
  },
};
