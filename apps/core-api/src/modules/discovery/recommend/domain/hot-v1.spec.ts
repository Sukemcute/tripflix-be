import { accountWeight, hotV1, HotV1FeaturesSchema } from './builders/hot.js';
import type { Kind, PostBuildItem, PostInteractionSample } from './contracts.js';
import { resolveAlgo } from './registry.js';

const NOW = new Date('2026-11-16T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

const repeat = (kind: Kind, count: number, actorAgeDays: number | null = null): PostInteractionSample[] => [{ kind, actorAgeDays, count }];

const video = (postId: string, ageHours: number, interactionSamples: PostInteractionSample[]): PostBuildItem => ({
  postId,
  authorId: `author-${postId}`,
  postType: 'video',
  tags: ['travel'],
  placeId: 'da-lat',
  publishedAt: hoursAgo(ageHours),
  interactions: {},
  interactions24h: {},
  interactionSamples,
});

describe('hot@v1 (TF23)', () => {
  it('resolveAlgo chấp nhận hot@v1 cho cả popular_v0 và tag_affinity_v0', () => {
    expect(resolveAlgo({ name: 'trending', postBuilder: 'hot@v1', userBuilder: 'none@v0', ranker: 'popular_v0' }).ok).toBe(true);
    expect(resolveAlgo({ name: 'for_you', postBuilder: 'hot@v1', userBuilder: 'tag_affinity@v0', ranker: 'tag_affinity_v0' }).ok).toBe(true);
  });

  it('accountWeight hạ trọng số tài khoản < 7 ngày và giữ sàn 0.2', () => {
    expect(accountWeight(null)).toBe(1);
    expect(accountWeight(0)).toBe(0.2);
    expect(accountWeight(1)).toBe(0.2);
    expect(accountWeight(3.5)).toBeCloseTo(0.5);
    expect(accountWeight(7)).toBe(1);
    expect(accountWeight(30)).toBe(1);
  });

  it('bộ dữ liệu thử (chưa có lượt xem): thứ hạng khớp kỳ vọng theo đơn đặt, lưu, tuổi bài và tuổi tài khoản', async () => {
    // 8 video cùng kịch bản thực tế trước khi có sự kiện content.post.viewed.
    // Thứ hạng kỳ vọng từ cao xuống thấp:
    // 1. v1_fresh_orders: mới 6h, 2 đơn đặt (2*10 = 20) + 5 bookmark (5*4 = 20) -> signal 40
    // 2. v2_fresh_bookmarks: mới 6h, 8 bookmark (32) -> signal 32
    // 3. v3_old_orders: cũ 18h, 2 đơn đặt (20) + 5 bookmark (20) -> cùng signal 40 với v1 nhưng cũ hơn nên tụt dưới v1 & v2
    // 4. v4_old_account_likes: mới 12h, 10 reaction từ tài khoản cũ (10*1 = 10)
    // 5. v5_new_account_spam: mới 12h, 20 reaction từ tài khoản 1 ngày tuổi (20*0.2 = 4) -> thua v4 dù gấp đôi lượt tim
    // 6. v6_very_old_likes: cũ 7 ngày (168h), 10 reaction từ tài khoản cũ (10) -> tụt sâu theo tuổi bài
    // 7. v7_single_like: cũ 72h, 1 reaction (1)
    // 8. v8_no_interaction: mới 6h, 0 tương tác -> 0 điểm
    const dataset: PostBuildItem[] = [
      video('v8_no_interaction', 6, []),
      video('v5_new_account_spam', 12, repeat('reaction', 20, 1)),
      video('v3_old_orders', 18, [...repeat('order_item', 2, 30), ...repeat('bookmark', 5, 30)]),
      video('v7_single_like', 72, repeat('reaction', 1, 14)),
      video('v1_fresh_orders', 6, [...repeat('order_item', 2, 30), ...repeat('bookmark', 5, 30)]),
      video('v6_very_old_likes', 168, repeat('reaction', 10, 30)),
      video('v4_old_account_likes', 12, repeat('reaction', 10, 30)),
      video('v2_fresh_bookmarks', 6, repeat('bookmark', 8, 30)),
    ];

    const out = await hotV1.build(dataset, NOW);
    for (const o of out) {
      expect(HotV1FeaturesSchema.safeParse(o.features).success).toBe(true);
    }

    const byId = Object.fromEntries(out.map((o) => [o.postId, o]));
    const rankedIds = [...out].sort((a, b) => b.score - a.score).map((o) => o.postId);

    expect(rankedIds).toEqual([
      'v1_fresh_orders',
      'v2_fresh_bookmarks',
      'v3_old_orders',
      'v4_old_account_likes',
      'v5_new_account_spam',
      'v6_very_old_likes',
      'v7_single_like',
      'v8_no_interaction',
    ]);
    expect(byId.v5_new_account_spam!.features.signal).toBe(4);
    expect(byId.v4_old_account_likes!.features.signal).toBe(10);
    expect(byId.v1_fresh_orders!.features.orders).toBe(2);
    expect(byId.v8_no_interaction!.score).toBe(0);
  });

  it('khi đã có lượt xem: cùng số lượt xem thì video nhiều lưu/đặt xếp trên; cùng tín hiệu thì ít view hơn xếp trên', async () => {
    const dataset: PostBuildItem[] = [
      // Cùng 100 views, cùng 12h tuổi:
      video('v_orders', 12, [...repeat('view', 100), ...repeat('order_item', 2, 30)]),
      video('v_bookmarks', 12, [...repeat('view', 100), ...repeat('bookmark', 10, 30)]),
      video('v_likes', 12, [...repeat('view', 100), ...repeat('reaction', 10, 30)]),
      // Cùng 10 bookmark, cùng 12h tuổi nhưng ít view hơn (50 views vs 100 views):
      video('v_bookmarks_high_rate', 12, [...repeat('view', 50), ...repeat('bookmark', 10, 30)]),
    ];

    const out = await hotV1.build(dataset, NOW);
    const s = Object.fromEntries(out.map((o) => [o.postId, o.score]));

    expect(s.v_bookmarks_high_rate!).toBeGreaterThan(s.v_bookmarks!);
    expect(s.v_bookmarks!).toBeGreaterThan(s.v_likes!);
    expect(s.v_orders!).toBeGreaterThan(s.v_likes!);
  });

  it('fallback về interactions khi không có interactionSamples và xử lý lô rỗng', async () => {
    expect(await hotV1.build([], NOW)).toEqual([]);

    const out = await hotV1.build(
      [
        {
          postId: 'p1',
          authorId: 'a1',
          postType: 'video',
          tags: [],
          placeId: null,
          publishedAt: hoursAgo(4),
          interactions: { order_item: 1, bookmark: 2, reaction: 3 },
          interactions24h: {},
        },
      ],
      NOW,
    );
    expect(out[0]!.features.signal).toBe(1 * 10 + 2 * 4 + 3 * 1);
    expect(out[0]!.features.orders).toBe(1);
    expect(out[0]!.score).toBe(1);
  });
});
