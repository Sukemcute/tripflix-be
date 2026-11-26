import type { EventEnvelope } from '@tripflix/contracts';
import { APPEND_ONLY_DAILY_CAP } from '../domain/row-limits.js';
import { RecommendIngestUseCases } from './ingest.use-cases.js';
import type { IngestQuota, RecentPostsStore, RecommendStore } from './ports.js';

const USER = '00000000-0000-4000-8000-000000000001';
let seq = 0;
const searched = (at = '2026-11-25T08:00:00.000Z') =>
  ({
    eventId: `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`,
    type: 'discovery.search.performed',
    version: 1,
    producer: 'core-api',
    occurredAt: at,
    payload: { userId: USER, surface: 'explore', placeIds: ['da-lat'], intent: null, budgetMax: null, postType: null, resultCount: 3 },
  }) as unknown as EventEnvelope;

/** Bộ đếm trong RAM giống RedisIngestQuota. */
function memoryQuota(): IngestQuota & { counts: Map<string, number> } {
  const counts = new Map<string, number>();
  return {
    counts,
    add: async (actorId, kind, day, count) => {
      const k = `${day}:${kind}:${actorId}`;
      counts.set(k, (counts.get(k) ?? 0) + count);
      return counts.get(k)!;
    },
  };
}

describe('RecommendIngestUseCases: hạn mức dòng chỉ-thêm mỗi ngày', () => {
  const setup = (quota?: IngestQuota) => {
    const store = { upsertInteractions: vi.fn().mockResolvedValue(undefined), cancelOrderItems: vi.fn() };
    const recent = { record: vi.fn().mockResolvedValue(undefined), list: vi.fn() };
    const useCases = new RecommendIngestUseCases(store as unknown as RecommendStore, recent as unknown as RecentPostsStore, quota);
    return { store, useCases };
  };

  it('nạp tới trần, bỏ phần vượt trong cùng ngày', async () => {
    const { store, useCases } = setup(memoryQuota());
    for (let i = 0; i < APPEND_ONLY_DAILY_CAP + 3; i++) await useCases.ingest(searched());
    expect(store.upsertInteractions).toHaveBeenCalledTimes(APPEND_ONLY_DAILY_CAP);
  });

  it('sang ngày mới thì đếm lại', async () => {
    const quota = memoryQuota();
    quota.counts.set(`2026-11-25:search:${USER}`, APPEND_ONLY_DAILY_CAP);
    const { store, useCases } = setup(quota);
    await useCases.ingest(searched('2026-11-25T23:00:00.000Z'));
    await useCases.ingest(searched('2026-11-26T01:00:00.000Z'));
    expect(store.upsertInteractions).toHaveBeenCalledTimes(1);
    expect(store.upsertInteractions.mock.calls[0]![0][0]).toMatchObject({ kind: 'search', occurredAt: '2026-11-26T01:00:00.000Z' });
  });

  it('Redis lỗi: vẫn nạp (trần lúc đọc và job dọn chặn phía sau)', async () => {
    const { store, useCases } = setup({ add: () => Promise.reject(new Error('redis down')) });
    await useCases.ingest(searched());
    expect(store.upsertInteractions).toHaveBeenCalledTimes(1);
  });

  it('không có bộ đếm (test, công cụ): không chặn', async () => {
    const { store, useCases } = setup();
    for (let i = 0; i < 3; i++) await useCases.ingest(searched());
    expect(store.upsertInteractions).toHaveBeenCalledTimes(3);
  });
});
