import { z } from 'zod';
import { round4, type Kind, type PostBuilder, type PostBuildItem } from '../contracts.js';

export const HotV0FeaturesSchema = z.object({
  reactions: z.number(),
  comments: z.number(),
  shares: z.number(),
  bookmarks: z.number(),
  velocity24h: z.number(),
  ageHours: z.number(),
});

export const HotV1FeaturesSchema = z.object({
  signal: z.number(),
  reactions: z.number(),
  comments: z.number(),
  shares: z.number(),
  bookmarks: z.number(),
  orders: z.number(),
  views: z.number(),
  velocity24h: z.number(),
  ageHours: z.number(),
});

export const HotV2FeaturesSchema = HotV1FeaturesSchema.extend({
  completeness: z.number(),
  hasPlan: z.boolean(),
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

export const HOT_V1_WEIGHTS: Partial<Record<Kind, number>> = {
  reaction: 1,
  comment: 3,
  bookmark: 4,
  share: 5,
  order_item: 10,
};

export const HOT_V1_VIEW_SMOOTHING_K = 20;

/** Tài khoản < 7 ngày tuổi bị hạ trọng số tuyến tính theo ngày, sàn 0.2; chưa có mốc đăng ký mặc định 1. */
export function accountWeight(ageDays: number | null): number {
  if (ageDays === null) return 1;
  return Math.max(0.2, Math.min(1, Math.max(0, ageDays) / 7));
}

function summarizeItemV1(item: PostBuildItem) {
  if (!item.interactionSamples) {
    const reactions = item.interactions.reaction ?? 0;
    const comments = item.interactions.comment ?? 0;
    const bookmarks = item.interactions.bookmark ?? 0;
    const shares = item.interactions.share ?? 0;
    const orders = item.interactions.order_item ?? 0;
    const views = item.interactions.view ?? 0;
    const signal =
      reactions * (HOT_V1_WEIGHTS.reaction ?? 0) +
      comments * (HOT_V1_WEIGHTS.comment ?? 0) +
      bookmarks * (HOT_V1_WEIGHTS.bookmark ?? 0) +
      shares * (HOT_V1_WEIGHTS.share ?? 0) +
      orders * (HOT_V1_WEIGHTS.order_item ?? 0);
    return { signal, reactions, comments, bookmarks, shares, orders, views };
  }

  let signal = 0;
  let reactions = 0;
  let comments = 0;
  let bookmarks = 0;
  let shares = 0;
  let orders = 0;
  let views = 0;
  for (const s of item.interactionSamples) {
    if (s.kind === 'view') {
      views += s.count;
      continue;
    }
    const w = HOT_V1_WEIGHTS[s.kind];
    if (w) signal += w * accountWeight(s.actorAgeDays) * s.count;
    if (s.kind === 'reaction') reactions += s.count;
    else if (s.kind === 'comment') comments += s.count;
    else if (s.kind === 'bookmark') bookmarks += s.count;
    else if (s.kind === 'share') shares += s.count;
    else if (s.kind === 'order_item') orders += s.count;
  }
  return { signal, reactions, comments, bookmarks, shares, orders, views };
}

function buildHotBase(items: PostBuildItem[], now: Date) {
  const summaries = items.map((item) => {
    const ageHours = Math.max(0, (now.getTime() - Date.parse(item.publishedAt)) / 3_600_000);
    const velocity24h = Object.values(item.interactions24h).reduce((sum, n) => sum + (n ?? 0), 0);
    const s = summarizeItemV1(item);
    return {
      postId: item.postId,
      ageHours,
      velocity24h,
      completeness: item.completeness ?? 0,
      hasPlan: item.hasPlan ?? false,
      ...s,
    };
  });

  const hasViewSignal = summaries.some((s) => s.views > 0);
  return summaries.map((s) => {
    const viewDenom = hasViewSignal ? s.views + HOT_V1_VIEW_SMOOTHING_K : 1;
    const rawV1 = Math.log1p(s.signal) / viewDenom / (s.ageHours + 2) ** 1.2;
    return {
      postId: s.postId,
      rawV1,
      completeness: s.completeness,
      hasPlan: s.hasPlan,
      features: {
        signal: round4(s.signal),
        reactions: s.reactions,
        comments: s.comments,
        shares: s.shares,
        bookmarks: s.bookmarks,
        orders: s.orders,
        views: s.views,
        velocity24h: s.velocity24h,
        ageHours: Math.round(s.ageHours * 100) / 100,
      },
    };
  });
}

function normalizeByP99<F extends Record<string, unknown>>(rows: Array<{ postId: string; raw: number; features: F }>) {
  const p99 = percentile(rows.map((r) => r.raw), 99);
  return rows.map((r) => ({
    postId: r.postId,
    score: p99 > 0 ? round4(Math.min(1, Math.max(0, r.raw / p99))) : 0,
    features: r.features,
  }));
}

/**
 * hot@v1 (TF23):
 * - signal = Σ (w_loại × w_tài_khoản) gồm reaction(1), comment(3), bookmark(4), share(5), order_item(10)
 * - Khi có dữ liệu lượt xem trong lô: raw = log1p(signal) / (views + K) / (ageHours + 2)^1.2
 * - Khi chưa có sự kiện lượt xem: bỏ mẫu (views + K) để chạy bình thường với tín hiệu hiện có
 * - Chuẩn hoá theo p99 cả lô, kẹp [0, 1].
 */
export const hotV1: PostBuilder = {
  key: 'hot@v1',
  needsSamples: true,
  featuresSchema: HotV1FeaturesSchema,
  build(items, now) {
    const rows = buildHotBase(items, now).map((r) => ({
      postId: r.postId,
      raw: r.rawV1,
      features: r.features,
    }));
    return Promise.resolve(normalizeByP99(rows));
  },
};

/**
 * hot@v2 (TF108):
 * - Bằng hot@v1, nhân thêm hệ số hoàn thiện bài viết: raw_v2 = raw_v1 × (0.5 + 0.5 × completeness).
 * - Bài 0 tương tác vẫn ra 0; bài đủ mọi thành phần được tối đa gấp đôi bài trống cùng tương tác & tuổi.
 */
export const hotV2: PostBuilder = {
  key: 'hot@v2',
  needsSamples: true,
  featuresSchema: HotV2FeaturesSchema,
  build(items, now) {
    const rows = buildHotBase(items, now).map((r) => ({
      postId: r.postId,
      raw: r.rawV1 * (0.5 + 0.5 * r.completeness),
      features: {
        ...r.features,
        completeness: r.completeness,
        hasPlan: r.hasPlan,
      },
    }));
    return Promise.resolve(normalizeByP99(rows));
  },
};
