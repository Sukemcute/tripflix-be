import type { EventEnvelope } from '@tripflix/contracts';
import { AiUsageQuerySchema } from './api/ai-usage.controller.js';
import { AiUsageUseCases, type AiUsageStore } from './application/ai-usage.use-cases.js';
import { AiUsageConsumer } from './consumers/ai-usage.consumer.js';
import { sumAiUsage, toAiUsageRecord, type AiUsageRecord } from './domain/ai-usage.js';

// Đúng dạng ai-service phát (tripflix-ai app/services/usage_events.py, UsageEvent.model_dump_json(by_alias=True)).
const chatEvent = (payload: Record<string, unknown> = {}): EventEnvelope => ({
  eventId: '0b9c3f0e-8a63-4d0f-9d58-3c1f2b7a1e01',
  type: 'ai.usage.recorded',
  version: 1,
  occurredAt: '2026-11-17T01:02:03.123456Z',
  producer: 'ai-service',
  userId: null,
  payload: {
    model: 'gpt-5-nano',
    inputTokens: 1200,
    outputTokens: 80,
    costUsd: 0.000092,
    estimated: true,
    feature: 'chat',
    conversationId: '7d1e6a52-0f0b-4c8e-9a51-2f3b5c6d7e8f',
    step: 'controller',
    ...payload,
  },
});

/** Store trong bộ nhớ: khoá theo id như bảng thật. */
class MemoryStore implements AiUsageStore {
  readonly rows = new Map<string, AiUsageRecord>();
  async insert(record: AiUsageRecord) {
    if (this.rows.has(record.id)) return false;
    this.rows.set(record.id, record);
    return true;
  }
  async summarize() {
    return [...this.rows.values()].map((r) => ({
      key: r.feature,
      calls: 1,
      inputTokens: r.inputTokens ?? 0,
      outputTokens: r.outputTokens ?? 0,
      costUsd: r.costUsd,
      unpricedCalls: r.feature === 'cover_ocr' && r.inputTokens === null ? 1 : 0,
    }));
  }
}

describe('toAiUsageRecord', () => {
  it('đọc sự kiện chat của ai-service, giữ conversationId; userId null thì để null (SCRUM-179)', () => {
    expect(toAiUsageRecord(chatEvent())).toEqual({
      id: '0b9c3f0e-8a63-4d0f-9d58-3c1f2b7a1e01',
      occurredAt: new Date('2026-11-17T01:02:03.123Z'),
      feature: 'chat',
      step: 'controller',
      model: 'gpt-5-nano',
      inputTokens: 1200,
      outputTokens: 80,
      costUsd: 0.000092,
      isEstimated: true,
      userId: null,
      conversationId: '7d1e6a52-0f0b-4c8e-9a51-2f3b5c6d7e8f',
      turnId: null,
      latencyMs: null,
    });
  });

  it('kiểm duyệt không có token thì để null', () => {
    const record = toAiUsageRecord(
      chatEvent({ feature: 'moderation', inputTokens: null, outputTokens: null, costUsd: 0, estimated: false, step: undefined }),
    );
    expect(record).toMatchObject({ feature: 'moderation', inputTokens: null, outputTokens: null, step: null });
  });

  it('OCR có usage và lượt thiếu usage đều được nhận, không gán nhầm chi phí chưa biết', () => {
    const priced = toAiUsageRecord(chatEvent({
      feature: 'cover_ocr', step: 'completed', model: 'gpt-4.1-mini',
      inputTokens: 1000, outputTokens: 20, costUsd: 0.000372,
    }));
    const missing = toAiUsageRecord(chatEvent({
      feature: 'cover_ocr', step: 'usage_missing', model: 'gpt-4.1-mini',
      inputTokens: null, outputTokens: null, costUsd: 0,
    }));
    expect(priced).toMatchObject({ feature: 'cover_ocr', inputTokens: 1000, costUsd: 0.000372 });
    expect(missing).toMatchObject({ feature: 'cover_ocr', step: 'usage_missing', inputTokens: null });
  });

  it('sự kiện khác loại thì bỏ qua; payload sai thì ném', () => {
    expect(toAiUsageRecord({ ...chatEvent(), type: 'ai.summary.ready' })).toBeNull();
    expect(() => toAiUsageRecord(chatEvent({ costUsd: -1 }))).toThrow();
    expect(() => toAiUsageRecord(chatEvent({ feature: 'image' }))).toThrow();
  });
});

describe('AiUsageUseCases', () => {
  it('sự kiện giao lại không đếm trùng; báo cáo có dòng tổng', async () => {
    const store = new MemoryStore();
    const usage = new AiUsageUseCases(store);
    expect(await usage.record(chatEvent())).toBe(true);
    expect(await usage.record(chatEvent())).toBe(false);
    const report = await usage.report({ from: new Date(0), to: new Date(), groupBy: 'feature' });
    expect(report.total).toEqual({ calls: 1, inputTokens: 1200, outputTokens: 80, costUsd: 0.000092, unpricedCalls: 0 });
  });

  it('sumAiUsage cộng mọi nhóm', () => {
    expect(
      sumAiUsage([
        { key: 'chat', calls: 2, inputTokens: 10, outputTokens: 1, costUsd: 0.5, unpricedCalls: 0 },
        { key: 'cover_ocr', calls: 1, inputTokens: 5, outputTokens: 2, costUsd: 0.25, unpricedCalls: 1 },
      ]),
    ).toEqual({ calls: 3, inputTokens: 15, outputTokens: 3, costUsd: 0.75, unpricedCalls: 1 });
  });
});

describe('AiUsageConsumer.handle', () => {
  const consumerWith = (store: AiUsageStore) =>
    new AiUsageConsumer(
      { APP_ROLE: 'api' } as never,
      {} as never,
      new AiUsageUseCases(store),
      { record: async () => false } as never,
    );

  it('payload sai hợp đồng thì bỏ qua (không ném, không thử lại)', async () => {
    const store = new MemoryStore();
    await expect(consumerWith(store).handle(chatEvent({ costUsd: 'nhieu' }))).resolves.toBeUndefined();
    expect(store.rows.size).toBe(0);
  });

  it('lỗi database thì ném để Redis giao lại', async () => {
    const store = new MemoryStore();
    store.insert = async () => {
      throw new Error('connection refused');
    };
    await expect(consumerWith(store).handle(chatEvent())).rejects.toThrow('connection refused');
  });
});

describe('AiUsageQuerySchema', () => {
  it('ngày theo giờ Việt Nam, gồm cả ngày to', () => {
    const q = AiUsageQuerySchema.parse({ from: '2026-11-11', to: '2026-11-17', groupBy: 'day' });
    expect(q.from.toISOString()).toBe('2026-11-10T17:00:00.000Z');
    expect(q.to.toISOString()).toBe('2026-11-17T17:00:00.000Z');
    expect(q.groupBy).toBe('day');
  });

  it('mặc định 7 ngày tới hôm nay, nhóm theo tính năng', () => {
    const q = AiUsageQuerySchema.parse({});
    expect(q.to.getTime() - q.from.getTime()).toBe(7 * 86_400_000);
    expect(q.groupBy).toBe('feature');
  });

  it('from sau to, quá 92 ngày, ngày sai dạng, groupBy lạ thì lỗi', () => {
    expect(AiUsageQuerySchema.safeParse({ from: '2026-11-18', to: '2026-11-17' }).success).toBe(false);
    expect(AiUsageQuerySchema.safeParse({ from: '2026-01-01', to: '2026-11-17' }).success).toBe(false);
    expect(AiUsageQuerySchema.safeParse({ from: '17/11/2026' }).success).toBe(false);
    expect(AiUsageQuerySchema.safeParse({ groupBy: 'user' }).success).toBe(false);
  });
});
