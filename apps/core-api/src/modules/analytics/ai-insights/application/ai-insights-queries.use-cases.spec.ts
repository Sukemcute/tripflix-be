import { describe, expect, it, vi } from 'vitest';
import type { AccessFacade } from '../../../access/index.js';
import type { AiTraceRow, AiUserUsageRow } from '../domain/ai-insights.js';
import { AiInsightsQueries } from './ai-insights-queries.use-cases.js';
import type { AiInsightsStore } from './ai-insights.store.js';

const user = '11111111-1111-4111-8111-111111111111';
const gone = '22222222-2222-4222-8222-222222222222';
const at = new Date('2026-11-18T10:00:00.000Z');

const userRow = (userId: string): AiUserUsageRow => ({
  userId,
  calls: 4,
  conversations: 2,
  inputTokens: 500,
  outputTokens: 50,
  costUsd: 0.002,
  lastAt: at,
});
const traceRow = (userId: string): AiTraceRow => ({
  eventId: 'e1',
  turnId: 't1',
  userId,
  occurredAt: at,
  question: 'tour Huế',
  intent: 'search',
  answerKind: 'answer',
  isAction: false,
  latencyMs: 900,
  steps: 2,
  inputTokens: 100,
  outputTokens: 10,
  costUsd: 0.001,
});

function queriesWith(store: Partial<AiInsightsStore>) {
  const contacts = new Map([[user, { displayName: 'An', email: 'an@example.com', createdAt: at }]]);
  const access = { getUserContacts: vi.fn(async () => contacts) } as unknown as AccessFacade;
  return { queries: new AiInsightsQueries(store as AiInsightsStore, access), access };
}

describe('AiInsightsQueries', () => {
  it('xếp hạng người dùng kèm tên, email; tài khoản đã mất thì null', async () => {
    const userRanking = vi.fn(async () => ({ rows: [userRow(user), userRow(gone)], total: 2 }));
    const { queries, access } = queriesWith({ userRanking });

    const { items, total } = await queries.users({ from: at, to: at, page: 3, pageSize: 10 });

    expect(total).toBe(2);
    expect(items[0]).toMatchObject({ displayName: 'An', email: 'an@example.com' });
    expect(items[1]).toMatchObject({ displayName: null, email: null });
    expect(userRanking).toHaveBeenCalledWith(expect.objectContaining({ limit: 10, offset: 20 }));
    expect(access.getUserContacts).toHaveBeenCalledWith([user, gone]);
  });

  it('danh sách trace kèm người dùng và chuyển bộ lọc xuống store', async () => {
    const traceList = vi.fn(async () => ({ rows: [traceRow(user)], total: 1 }));
    const { queries } = queriesWith({ traceList });

    const { items } = await queries.traces({ from: at, to: at, page: 1, pageSize: 20, answerKind: 'error', minCostUsd: 0.5 });

    expect(items[0]).toMatchObject({ email: 'an@example.com', question: 'tour Huế' });
    expect(traceList).toHaveBeenCalledWith(expect.objectContaining({ answerKind: 'error', minCostUsd: 0.5, offset: 0 }));
  });

  it('chi tiết trace: không có lượt thì null, có thì kèm người dùng và các bước', async () => {
    const steps = [
      { id: 's1', step: 'controller', model: 'm', inputTokens: 1, outputTokens: 1, costUsd: 0, latencyMs: 10, occurredAt: at, isEstimated: true },
    ];
    const traceDetail = vi.fn(async (turnId: string) => (turnId === 't1' ? { trace: traceRow(user), steps } : null));
    const { queries } = queriesWith({ traceDetail });

    expect(await queries.trace('khac')).toBeNull();
    expect(await queries.trace('t1')).toMatchObject({ trace: { displayName: 'An' }, steps });
  });

  it('biểu đồ điền 0 cho bucket trống', async () => {
    const from = new Date('2026-11-16T17:00:00Z');
    const timeseries = vi.fn(async () => [
      { at: new Date('2026-11-17T17:00:00Z'), calls: 5, inputTokens: 50, outputTokens: 5, costUsd: 0.005 },
    ]);
    const { queries } = queriesWith({ timeseries });

    const points = await queries.timeseries({ from, to: new Date('2026-11-19T17:00:00Z'), bucket: 'day' });

    expect(points.map((point) => point.calls)).toEqual([0, 5, 0]);
  });
});
