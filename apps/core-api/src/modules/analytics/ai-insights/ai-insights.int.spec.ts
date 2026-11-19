import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { EventEnvelope } from '@tripflix/contracts';
import { createDb, createPool } from '@tripflix/db';
import { migrateModule, startPostgres, type PostgresFixture } from '@tripflix/testing';
import type pg from 'pg';
import { AiUsageUseCases } from '../ai-usage/application/ai-usage.use-cases.js';
import { DrizzleAiUsageStore } from '../ai-usage/infra/drizzle-ai-usage.store.js';
import { UserActivityUseCases } from '../user-activity/application/user-activity.use-cases.js';
import { DrizzleUserActivityStore } from '../user-activity/infra/drizzle-user-activity.store.js';
import { DrizzleAiInsightsStore } from './infra/drizzle-ai-insights.store.js';

const alice = '11111111-1111-4111-8111-111111111111';
const bob = '22222222-2222-4222-8222-222222222222';
const turnA = '55555555-5555-4555-8555-555555555555';
const turnB = '66666666-6666-4666-8666-666666666666';

describe('AI insights: SQL thật trên PostgreSQL (SCRUM-179)', () => {
  let postgres: PostgresFixture | undefined;
  let pool: pg.Pool | undefined;
  let usage: AiUsageUseCases;
  let activity: UserActivityUseCases;
  let insights: DrizzleAiInsightsStore;
  let activityStore: DrizzleUserActivityStore;

  const llmCall = (turnId: string | undefined, userId: string | null, at: string, step: string, cost: number, extra = {}): EventEnvelope => ({
    eventId: randomUUID(),
    type: 'ai.usage.recorded',
    version: 1,
    occurredAt: at,
    producer: 'ai-service',
    userId,
    payload: {
      feature: 'chat',
      model: 'gpt-5-nano',
      step,
      inputTokens: 1000,
      outputTokens: 100,
      costUsd: cost,
      estimated: true,
      conversationId: '77777777-7777-4777-8777-777777777777',
      ...(turnId ? { turnId } : {}),
      ...extra,
    },
  });

  const chatTurn = (turnId: string | undefined, userId: string, at: string, question: string, answerKind = 'answer'): EventEnvelope => ({
    eventId: randomUUID(),
    type: 'ai.chat.turn.recorded',
    version: 1,
    occurredAt: at,
    producer: 'ai-service',
    userId,
    payload: {
      conversationId: '77777777-7777-4777-8777-777777777777',
      question,
      intent: 'search',
      answerKind,
      isAction: false,
      ...(turnId ? { turnId, latencyMs: 1800 } : {}),
    },
  });

  beforeAll(async () => {
    postgres = await startPostgres();
    const url = postgres.buildModuleUrl('analytics');
    await migrateModule({ url, module: 'analytics', migrationsFolder: fileURLToPath(new URL('../db/migrations', import.meta.url)) });
    pool = createPool({ url, max: 3, applicationName: 'analytics-ai-insights-test' });
    const db = createDb(pool);
    usage = new AiUsageUseCases(new DrizzleAiUsageStore(db));
    activityStore = new DrizzleUserActivityStore(db);
    activity = new UserActivityUseCases(activityStore);
    insights = new DrizzleAiInsightsStore(db);

    // Alice: 1 lượt có đủ 2 bước (turnA) + 1 lượt lỗi chỉ có 1 bước (turnB). Bob: 1 lượt chat cũ chưa có turnId. Một tóm tắt không có người dùng.
    await usage.record(llmCall(turnA, alice, '2026-11-17T17:30:00.000Z', 'controller', 0.001, { latencyMs: 300 }));
    await usage.record(llmCall(turnA, alice, '2026-11-17T17:30:01.000Z', 'responder', 0.003, { latencyMs: 900 }));
    await usage.record(llmCall(turnB, alice, '2026-11-18T05:00:00.000Z', 'controller', 0.0005, { latencyMs: 250 }));
    await usage.record(llmCall(undefined, bob, '2026-11-18T06:00:00.000Z', 'controller', 0.002));
    await usage.record(llmCall(undefined, null, '2026-11-18T07:00:00.000Z', 'responder', 0.5, { feature: 'summary', conversationId: undefined }));
    await activity.record(chatTurn(turnA, alice, '2026-11-17T17:30:02.000Z', 'tour Huế 3 ngày'));
    await activity.record(chatTurn(turnB, alice, '2026-11-18T05:00:02.000Z', 'khách sạn Đà Lạt', 'error'));
    await activity.record(chatTurn(undefined, bob, '2026-11-18T06:00:02.000Z', 'vé máy bay Phú Quốc'));
  });
  afterAll(async () => {
    await pool?.end();
    await postgres?.stop();
  });

  const window = { from: new Date('2026-11-16T17:00:00Z'), to: new Date('2026-11-18T17:00:00Z') };

  it('biểu đồ theo ngày giờ Việt Nam: cộng đúng lần gọi, token, chi phí; thời gian trả về là Date', async () => {
    const points = await insights.timeseries({ ...window, bucket: 'day' });

    // 17:30 UTC ngày 17 là 00:30 ngày 18 ở Việt Nam: hai bước của turnA thuộc ngày 18 giờ VN; 05:00, 06:00, 07:00 UTC cũng ngày 18.
    expect(points).toHaveLength(1);
    expect(points[0]?.at.toISOString()).toBe('2026-11-17T17:00:00.000Z');
    expect(points[0]).toMatchObject({ calls: 5, inputTokens: 5000, outputTokens: 500 });
    expect(points[0]?.costUsd).toBeCloseTo(0.001 + 0.003 + 0.0005 + 0.002 + 0.5, 6);
  });

  it('biểu đồ theo giờ và lọc theo tính năng, model', async () => {
    const hourly = await insights.timeseries({ ...window, bucket: 'hour', feature: 'chat' });
    expect(hourly.reduce((sum, p) => sum + p.calls, 0)).toBe(4);
    expect(await insights.timeseries({ ...window, bucket: 'day', model: 'khong-co' })).toEqual([]);
  });

  it('xếp hạng người dùng: bỏ lượt không có người dùng, tốn nhiều nhất trước, đếm đúng cuộc trò chuyện', async () => {
    const { rows, total } = await insights.userRanking({ ...window, limit: 10, offset: 0 });

    expect(total).toBe(2);
    expect(rows.map((r) => r.userId)).toEqual([alice, bob]);
    expect(rows[0]).toMatchObject({ calls: 3, conversations: 1, inputTokens: 3000, outputTokens: 300 });
    expect(rows[0]?.costUsd).toBeCloseTo(0.0045, 6);
    expect(rows[0]?.lastAt).toBeInstanceOf(Date);
    expect((await insights.userRanking({ ...window, limit: 1, offset: 1 })).rows.map((r) => r.userId)).toEqual([bob]);
    expect((await insights.userRanking({ ...window, userId: bob, limit: 10, offset: 0 })).total).toBe(1);
  });

  it('danh sách trace: nối các bước theo turnId, lượt chat cũ chưa có turnId thì token bằng 0', async () => {
    const { rows, total } = await insights.traceList({ ...window, limit: 10, offset: 0 });

    expect(total).toBe(3);
    expect(rows.map((r) => r.question)).toEqual(['vé máy bay Phú Quốc', 'khách sạn Đà Lạt', 'tour Huế 3 ngày']);
    const first = rows.find((r) => r.turnId === turnA);
    expect(first).toMatchObject({ steps: 2, inputTokens: 2000, outputTokens: 200, latencyMs: 1800, answerKind: 'answer', isAction: false });
    expect(first?.costUsd).toBeCloseTo(0.004, 6);
    expect(first?.occurredAt).toBeInstanceOf(Date);
    expect(rows.find((r) => r.userId === bob)).toMatchObject({ turnId: null, steps: 0, inputTokens: 0, latencyMs: null });
  });

  it('lọc trace theo người dùng, kết quả và chi phí tối thiểu', async () => {
    expect((await insights.traceList({ ...window, userId: alice, limit: 10, offset: 0 })).total).toBe(2);
    expect((await insights.traceList({ ...window, answerKind: 'error', limit: 10, offset: 0 })).rows.map((r) => r.turnId)).toEqual([turnB]);
    expect((await insights.traceList({ ...window, minCostUsd: 0.003, limit: 10, offset: 0 })).rows.map((r) => r.turnId)).toEqual([turnA]);
  });

  it('chi tiết trace: lượt cùng các bước theo thứ tự thời gian; turnId không có thì null', async () => {
    const detail = await insights.traceDetail(turnA);

    expect(detail?.trace).toMatchObject({ turnId: turnA, userId: alice, question: 'tour Huế 3 ngày' });
    expect(detail?.steps.map((s) => [s.step, s.latencyMs])).toEqual([['controller', 300], ['responder', 900]]);
    expect(detail?.steps[0]?.occurredAt).toBeInstanceOf(Date);
    expect(await insights.traceDetail(randomUUID())).toBeNull();
  });

  it('bỏ liên kết người dùng ở dòng cũ nhưng giữ số tổng; dòng mới vẫn còn liên kết', async () => {
    const before = await insights.timeseries({ ...window, bucket: 'day' });
    const totalBefore = before.reduce((sum, p) => sum + p.costUsd, 0);

    // Mốc cắt sau lượt chat của Alice ngày 17 và trước các lượt ngày 18.
    const changed = await insights.unlinkBefore(new Date('2026-11-18T00:00:00.000Z'));

    expect(changed).toBe(2);
    const after = await insights.timeseries({ ...window, bucket: 'day' });
    expect(after.reduce((sum, p) => sum + p.costUsd, 0)).toBeCloseTo(totalBefore, 8);
    expect((await insights.userRanking({ ...window, limit: 10, offset: 0 })).rows.find((r) => r.userId === alice)?.calls).toBe(1);
    expect((await insights.traceDetail(turnA))?.steps).toEqual([]);
    expect(await insights.unlinkBefore(new Date('2026-11-18T00:00:00.000Z'))).toBe(0);
  });

  it('hành vi người dùng: lastActiveAt là Date, đếm đúng lượt chat (hồi quy lỗi 500 ở #276)', async () => {
    const { rows } = await activityStore.summarize({ ...window, limit: 10, offset: 0 });

    expect(rows.find((r) => r.userId === alice)).toMatchObject({ chats: 2 });
    expect(rows.find((r) => r.userId === alice)?.lastActiveAt).toBeInstanceOf(Date);
    expect((await activityStore.recentEvents(alice, window, 10))[0]?.detail).toMatchObject({ question: 'khách sạn Đà Lạt' });
  });
});
