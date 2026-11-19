import { z } from 'zod';
import { assignBins } from '../bins.js';
import { round4, type PostBuilder, type PostBuildItem } from '../contracts.js';
import { hotV2, HotV2FeaturesSchema } from './hot.js';

export const PostProfileV1FeaturesSchema = HotV2FeaturesSchema.extend({
  /** Ngăn của bài: '<câu hỏi>:<mã>' → độ tin thuộc ngăn (bins.ts). */
  bins: z.record(z.string(), z.number()),
  /** "Đặt được ngay" 0..1: có lịch trình, đã xác thực, gắn khách sạn. */
  bookable: z.number(),
  /** Khách sạn gắn bài: ranker biết bài khoe khách sạn khác ở nơi người xem đã đặt. */
  hotelId: z.string().nullable(),
});
export type PostProfileV1Features = z.infer<typeof PostProfileV1FeaturesSchema>;

/** Phần features riêng của v1 (ngoài hot@v2). Bộ đo offline dùng lại để chấm đúng như job. */
export function profileFeaturesOf(item: Pick<PostBuildItem, 'tags' | 'placeId' | 'hasPlan' | 'content'>) {
  const hotelId = item.content?.trip?.hotelId ?? null;
  const bookable = round4(0.4 * (item.hasPlan ? 1 : 0) + 0.3 * (item.content?.isVerified ? 1 : 0) + 0.3 * (hotelId ? 1 : 0));
  return { bins: assignBins(item), bookable, hotelId };
}

/**
 * post_profile@v1 (TF28 v1): điểm giữ nguyên hot@v2, features = hot@v2 + ngăn + bookable.
 * Mỗi thuật toán chỉ có một post builder nên builder này gánh cả hai: ranker v1 đọc toàn bộ bài kèm ngăn từ một dòng.
 */
export const postProfileV1: PostBuilder = {
  key: 'post_profile@v1',
  needsSamples: true,
  needsVectors: true,
  featuresSchema: PostProfileV1FeaturesSchema,
  async build(items, now) {
    const byId = new Map(items.map((i) => [i.postId, i]));
    return (await hotV2.build(items, now)).map((hot) => {
      const item = byId.get(hot.postId)!;
      return { ...hot, features: { ...hot.features, ...profileFeaturesOf(item) } };
    });
  },
};
