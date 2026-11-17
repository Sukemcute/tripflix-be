import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { EventEnvelope } from '@tripflix/contracts';
import { createDb, createPool } from '@tripflix/db';
import { migrateModule, startPostgres, type PostgresFixture } from '@tripflix/testing';
import type pg from 'pg';
import { AiUsageUseCases } from './application/ai-usage.use-cases.js';
import { DrizzleAiUsageStore } from './infra/drizzle-ai-usage.store.js';

describe('AI usage: merged analytics migration and PostgreSQL store', () => {
  let postgres: PostgresFixture | undefined;
  let pool: pg.Pool | undefined;
  let usage: AiUsageUseCases;

  beforeAll(async () => {
    postgres = await startPostgres();
    const url = postgres.buildModuleUrl('analytics');
    await migrateModule({
      url,
      module: 'analytics',
      migrationsFolder: fileURLToPath(new URL('../db/migrations', import.meta.url)),
    });
    pool = createPool({ url, max: 3, applicationName: 'analytics-ai-usage-test' });
    usage = new AiUsageUseCases(new DrizzleAiUsageStore(createDb(pool)));
  });
  afterAll(async () => {
    await pool?.end();
    await postgres?.stop();
  });

  it('deduplicates concurrent deliveries by eventId and groups real totals by Vietnamese day', async () => {
    const event: EventEnvelope = {
      eventId: randomUUID(),
      type: 'ai.usage.recorded',
      version: 1,
      occurredAt: '2026-11-16T18:00:00.000Z',
      producer: 'ai-service',
      userId: null,
      payload: {
        feature: 'chat',
        model: 'gpt-5-nano',
        inputTokens: 1200,
        outputTokens: 80,
        costUsd: 0.000092,
        estimated: true,
      },
    };
    const writes = await Promise.all([usage.record(event), usage.record(event)]);
    expect(writes.sort()).toEqual([false, true]);
    expect(
      await usage.record({
        ...event,
        eventId: randomUUID(),
        occurredAt: '2026-11-17T04:30:00.000Z',
        payload: { ...event.payload, inputTokens: 25, outputTokens: 5, costUsd: 0.1 },
      }),
    ).toBe(true);
    const range = { from: new Date('2026-11-16T17:00:00Z'), to: new Date('2026-11-17T17:00:00Z') };
    const report = await usage.report({ ...range, groupBy: 'day' });
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]).toMatchObject({
      key: '2026-11-17',
      calls: 2,
      inputTokens: 1225,
      outputTokens: 85,
    });
    expect(report.total.costUsd).toBeCloseTo(0.100092, 8);
    expect((await usage.report({ ...range, groupBy: 'feature' })).rows[0]).toMatchObject({
      key: 'chat',
      calls: 2,
    });
    expect((await usage.report({ ...range, groupBy: 'model' })).rows[0]).toMatchObject({
      key: 'gpt-5-nano',
      calls: 2,
    });
  });
});
