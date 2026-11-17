import { hotV2, HotV2FeaturesSchema } from './builders/hot.js';
import type { PostBuildItem } from './contracts.js';
import { resolveAlgo } from './registry.js';

const NOW = new Date('2026-11-18T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

const makePost = (postId: string, completeness: number, hasPlan: boolean, likes = 10, ageHours = 6): PostBuildItem => ({
  postId,
  authorId: `author-${postId}`,
  postType: 'post',
  tags: ['travel'],
  placeId: 'da-lat',
  publishedAt: hoursAgo(ageHours),
  completeness,
  hasPlan,
  interactions: {},
  interactions24h: {},
  interactionSamples: likes > 0 ? [{ kind: 'reaction', actorAgeDays: 30, count: likes }] : [],
});

describe('hot@v2 (TF108)', () => {
  it('resolveAlgo chấp nhận hot@v2 cho cả popular_v0 và tag_affinity_v0', () => {
    expect(resolveAlgo({ name: 'trending', postBuilder: 'hot@v2', userBuilder: 'none@v0', ranker: 'popular_v0' }).ok).toBe(true);
    expect(resolveAlgo({ name: 'for_you', postBuilder: 'hot@v2', userBuilder: 'tag_affinity@v0', ranker: 'tag_affinity_v0' }).ok).toBe(true);
  });

  it('hai bài cùng tương tác và tuổi thì bài có lịch trình/hoàn thiện hơn xếp trên; bài 0 tương tác ra 0', async () => {
    const dataset: PostBuildItem[] = [
      makePost('p_empty_likes', 0, false, 10, 6),
      makePost('p_plan_likes', 0.9, true, 10, 6),
      makePost('p_zero_interaction', 1, true, 0, 6),
    ];

    const out = await hotV2.build(dataset, NOW);
    for (const o of out) {
      expect(HotV2FeaturesSchema.safeParse(o.features).success).toBe(true);
    }

    const byId = Object.fromEntries(out.map((o) => [o.postId, o]));
    expect(byId.p_plan_likes!.score).toBeGreaterThan(byId.p_empty_likes!.score);
    expect(byId.p_zero_interaction!.score).toBe(0);
    expect(byId.p_plan_likes!.features.completeness).toBe(0.9);
    expect(byId.p_plan_likes!.features.hasPlan).toBe(true);
  });
});
