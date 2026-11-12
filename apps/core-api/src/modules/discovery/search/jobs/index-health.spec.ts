import type { Redis } from 'ioredis';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CoreEnv } from '../../../../platform/env.js';
import { IndexHealth } from './index-health.js';

const minute = 60_000;
const now = Date.UTC(2026, 10, 12, 5);

function setup() {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  const entries: [string, string[]][] = [];
  const transaction = {
    xadd: vi.fn((_key, _minId, _exact, _cutoff, _id, field: string, value: string) => {
      entries.push([`${Date.now()}-${entries.length}`, [field, value]]);
      return transaction;
    }),
    pexpire: vi.fn(() => transaction),
    exec: vi.fn().mockResolvedValue([]),
  };
  const redis = {
    multi: () => transaction,
    xrange: async (_key: string, from: string) =>
      entries.filter(([id]) => Number(id.split('-')[0]) >= Number(from)),
  } as unknown as Redis;
  return {
    worker: new IndexHealth({ APP_ROLE: 'worker' } as CoreEnv, redis),
    api: new IndexHealth({ APP_ROLE: 'api' } as CoreEnv, redis),
  };
}

afterEach(() => vi.useRealTimers());

describe('IndexHealth', () => {
  it('keeps the heartbeat independent of a stuck job and marks a stopped worker offline', async () => {
    const { api, worker } = setup();
    api.onApplicationBootstrap();
    expect((await api.read()).workers).toEqual([]);

    worker.onApplicationBootstrap();
    worker.start('suggest', now);
    worker.finish('suggest', now, 'succeeded', 0);
    worker.start('explore', now);
    await vi.advanceTimersByTimeAsync(10 * minute);
    const [active] = (await api.read()).workers;
    expect(active).toMatchObject({
      lastSeenAt: now + 10 * minute,
      status: 'attention',
      jobs: [{ status: 'stuck' }, { status: 'succeeded', count: 0 }],
    });
    expect(active?.history).toHaveLength(24);
    expect(active?.history.at(-1)?.status).toBe('attention');

    worker.onApplicationShutdown();
    await vi.advanceTimersByTimeAsync(8 * minute);
    const [offline] = (await api.read()).workers;
    expect(offline).toMatchObject({
      status: 'offline',
      jobs: [{ status: 'unknown' }, { status: 'unknown' }],
    });
    expect(offline?.history.at(-1)?.status).toBe('offline');
    await vi.advanceTimersByTimeAsync(2 * 60 * minute);
    expect((await api.read()).workers).toEqual([]);
  });

  it('keeps the last successful count when a new run fails or skips', async () => {
    const { api, worker } = setup();
    worker.onApplicationBootstrap();
    worker.start('explore', now);
    worker.finish('explore', now, 'succeeded', 42);
    await vi.advanceTimersByTimeAsync(10 * minute);
    worker.start('explore', Date.now());
    worker.finish('explore', Date.now(), 'failed', undefined, new Error('catalog unavailable'));
    const [failed] = (await api.read()).workers;
    expect(failed?.jobs[0]).toMatchObject({ status: 'failed', lastSuccessAt: now, count: 42 });
    expect(failed?.jobs[0]?.logs[0]?.message).toContain('catalog unavailable');
    expect(failed?.jobs[0]?.logs[0]).toMatchObject({ outcome: 'failed', durationMs: 0, count: null });
    expect(failed?.jobs[0]?.logs[1]).toMatchObject({ outcome: null, durationMs: null, count: null });
    expect(failed?.jobs[0]?.logs[2]).toMatchObject({ outcome: 'succeeded', durationMs: 0, count: 42 });
    expect(failed?.jobs[0]?.logs).toHaveLength(4);

    await vi.advanceTimersByTimeAsync(10 * minute);
    worker.start('explore', Date.now());
    worker.finish('explore', Date.now(), 'skipped');
    expect((await api.read()).workers[0]?.jobs[0]).toMatchObject({
      status: 'skipped',
      lastSuccessAt: now,
      count: 42,
    });
    await vi.advanceTimersByTimeAsync(15 * minute);
    expect((await api.read()).workers[0]?.jobs[0]?.status).toBe('overdue');
    worker.onApplicationShutdown();
  });
});
