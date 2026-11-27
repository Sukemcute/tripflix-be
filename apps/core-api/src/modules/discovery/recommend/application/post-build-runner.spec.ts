import { z } from 'zod';
import type { PostBuilder, PostBuildItem } from '../domain/contracts.js';
import { buildPostScores, InProcessPostBuildRunner } from './post-build-runner.js';

const NOW = new Date('2026-11-27T00:00:00Z');
const items = [{ postId: 'p1' }] as PostBuildItem[];
const builder = (features: Record<string, unknown>): PostBuilder => ({
  key: 'test@v0',
  featuresSchema: z.object({ hot: z.number() }),
  build: vi.fn(async (input: PostBuildItem[]) => input.map((i) => ({ postId: i.postId, score: 1, features }))),
});

describe('buildPostScores', () => {
  it('trả điểm đã kiểm featuresSchema', async () => {
    expect(await buildPostScores(builder({ hot: 2 }), items, NOW)).toEqual([{ postId: 'p1', score: 1, features: { hot: 2 } }]);
  });

  it('features sai schema → ném (job ghi builder lỗi, giữ dữ liệu cũ)', async () => {
    await expect(buildPostScores(builder({ hot: 'cao' }), items, NOW)).rejects.toThrow();
  });
});

describe('InProcessPostBuildRunner', () => {
  it('signal đã huỷ thì không chạy builder kế tiếp', async () => {
    const controller = new AbortController();
    const session = await new InProcessPostBuildRunner().open(items, NOW, controller.signal);
    const first = builder({ hot: 1 });
    expect(await session.build(first)).toHaveLength(1);
    controller.abort(new Error('Dừng khẩn cấp: thử'));
    const buildSecond = vi.fn(async () => []);
    await expect(session.build({ ...builder({ hot: 1 }), build: buildSecond })).rejects.toThrow('Dừng khẩn cấp: thử');
    expect(buildSecond).not.toHaveBeenCalled();
    await session.close();
  });
});
