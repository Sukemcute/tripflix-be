import { EXP_DESCRIPTION_TEXTS } from '../domain/bins.js';
import { CAPTION_MODEL } from '../domain/topics.js';
import type { RecommendStore, TextEmbedder } from './ports.js';
import { QueryTopicUseCases } from './query-topics.use-cases.js';

/** Vector giả: mô tả ngăn thứ i là trục i; câu tìm "tắm biển cuối tuần" gần trục biển (i = 4). */
const unit = (i: number) => Array.from({ length: 9 }, (_, j) => (j === i ? 1 : 0));
const VECTORS: Record<string, number[]> = Object.fromEntries(EXP_DESCRIPTION_TEXTS.map((t, i) => [t, unit(i)]));
VECTORS['tắm cuối tuần cho mát'] = [0, 0, 0, 0, 0.9, 0, 0, 0.3, 0];
VECTORS['đi đâu cho đỡ buồn'] = Array.from({ length: 9 }, () => 0.33);

function setup(embed: TextEmbedder['embed'] = vi.fn(async (texts: string[]) => ({ model: CAPTION_MODEL, vectors: texts.map((t) => VECTORS[t]!) }))) {
  const cache = new Map<string, number[]>();
  const store = {
    findTextVectors: vi.fn(async (_m: string, hashes: string[]) => new Map(hashes.filter((h) => cache.has(h)).map((h) => [h, cache.get(h)!]))),
    insertTextVectors: vi.fn(async (_m: string, rows: Array<{ textHash: string; vector: number[] }>) => rows.forEach((r) => cache.set(r.textHash, r.vector))),
  };
  return { useCases: new QueryTopicUseCases(store as unknown as RecommendStore, { embed }), store, embed };
}

describe('QueryTopicUseCases', () => {
  it('từ khoá ra ngăn thì không gọi ai-service', async () => {
    const { useCases, embed } = setup();
    expect(await useCases.classify('biển')).toEqual(['exp:bien']);
    expect(embed).not.toHaveBeenCalled();
  });

  it('không có từ khoá: nhúng câu tìm, so với mô tả ngăn; lần sau đọc cache, không nhúng lại', async () => {
    const { useCases, embed } = setup();
    expect(await useCases.classify('tắm cuối tuần cho mát')).toEqual(['exp:bien']);
    expect(await useCases.classify('tắm cuối tuần cho mát')).toEqual(['exp:bien']);
    expect(embed).toHaveBeenCalledTimes(1);
  });

  it('câu mơ hồ (các ngăn sát nhau) thì không gán', async () => {
    expect(await setup().useCases.classify('đi đâu cho đỡ buồn')).toEqual([]);
  });

  it('ai-service lỗi, sai mô hình hoặc chậm quá 2 giây: trả rỗng', async () => {
    expect(await setup(vi.fn().mockRejectedValue(new Error('down'))).useCases.classify('tắm cuối tuần cho mát')).toEqual([]);
    expect(await setup(vi.fn(async (texts: string[]) => ({ model: 'khac', vectors: texts.map(() => unit(0)) }))).useCases.classify('tắm cuối tuần cho mát')).toEqual([]);
    vi.useFakeTimers();
    try {
      const pending = setup(() => new Promise(() => undefined)).useCases.classify('tắm cuối tuần cho mát');
      await vi.advanceTimersByTimeAsync(2_100);
      expect(await pending).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});
