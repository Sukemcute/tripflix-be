import type { FeedUseCases } from './application/feed.use-cases.js';
import type { TrendScoresUseCases } from './application/trend-scores.use-cases.js';
import { FeedFacade, type TopHotPostType } from './feed.facade.js';

function setup() {
  const page = { items: [{ postId: 'p1', score: 0.5, cursor: 'c1' }], nextCursor: null };
  const feed = { getHotIds: vi.fn(() => Promise.resolve(page)) };
  const scores = new Map([['p1', { score: 0.5, computedAt: '2026-11-20T00:00:00.000Z' }]]);
  const trendScores = { getScores: vi.fn(() => Promise.resolve(scores)) };
  const facade = new FeedFacade(feed as unknown as FeedUseCases, trendScores as unknown as TrendScoresUseCases);
  return { facade, feed, trendScores, page, scores };
}

describe('FeedFacade (TF111)', () => {
  it('listTopHot với video đọc đúng danh sách Hot như getHotIds', async () => {
    const { facade, feed, page } = setup();

    await expect(facade.listTopHot({ postType: 'video', limit: 5, cursor: null })).resolves.toBe(page);
    expect(feed.getHotIds).toHaveBeenCalledWith({ limit: 5, cursor: null });
  });

  it('listTopHot với loại bài chưa có điểm thì báo RangeError', async () => {
    const { facade, feed } = setup();

    await expect(
      facade.listTopHot({ postType: 'vlog' as TopHotPostType, limit: 5, cursor: null }),
    ).rejects.toThrow(RangeError);
    expect(feed.getHotIds).not.toHaveBeenCalled();
  });

  it('getHotScores trả điểm từ bảng trend_scores', async () => {
    const { facade, trendScores, scores } = setup();

    await expect(facade.getHotScores(['p1', 'p2'])).resolves.toBe(scores);
    expect(trendScores.getScores).toHaveBeenCalledWith(['p1', 'p2']);
  });
});
