import { describe, expect, it, vi } from 'vitest';
import type { Redis } from 'ioredis';
import type { CoreEnv } from '../../../platform/env.js';
import type { DbPools } from '../../../platform/tokens.js';
import { CommerceMetrics, METRICS_KEY_PREFIX, type InstanceMetrics } from './commerce-metrics.js';

const pools = { commerce: { totalCount: 7, idleCount: 2, waitingCount: 3, options: { max: 10 } } } as unknown as DbPools;
const env = { NODE_ENV: 'test', APP_ROLE: 'api' } as CoreEnv;

describe('CommerceMetrics (D1)', () => {
  it('snapshot gửi số pool commerce và bộ đếm 5 giây rồi đặt lại bộ đếm', () => {
    const metrics = new CommerceMetrics(env, pools, {} as Redis);
    metrics.countHold('created');
    metrics.countHold('created');
    metrics.countHold('sold_out');
    metrics.countPayment('paid');
    const first = metrics.snapshot();
    expect(first.pool).toEqual({ total: 7, idle: 2, waiting: 3, max: 10 });
    expect(first.holds).toEqual({ created: 2, sold_out: 1 });
    expect(first.payments).toEqual({ paid: 1 });
    expect(metrics.snapshot().holds).toEqual({});
  });

  it('ghi vào Redis một khoá mỗi instance, có hạn 30 giây', async () => {
    const set = vi.fn().mockResolvedValue('OK');
    const metrics = new CommerceMetrics(env, pools, { set } as unknown as Redis);
    await metrics.publish();
    expect(set).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`^${METRICS_KEY_PREFIX}`)), expect.any(String), 'EX', 30);
  });

  it('Redis lỗi thì bỏ qua, không ném lỗi ra luồng đặt chỗ', async () => {
    const metrics = new CommerceMetrics(env, pools, { set: vi.fn().mockRejectedValue(new Error('redis down')) } as unknown as Redis);
    await expect(metrics.publish()).resolves.toBeUndefined();
  });

  it('readAll cộng số của mọi instance; Redis lỗi thì báo isAvailable=false', async () => {
    const a: Partial<InstanceMetrics> = { pool: { total: 10, idle: 0, waiting: 4, max: 10 }, holds: { created: 3 }, payments: { paid: 1 } };
    const b: Partial<InstanceMetrics> = { pool: { total: 5, idle: 5, waiting: 1, max: 10 }, holds: { created: 2, lock_busy: 1 }, payments: {} };
    const redis = { scan: vi.fn().mockResolvedValue(['0', ['k1', 'k2']]), mget: vi.fn().mockResolvedValue([JSON.stringify(a), JSON.stringify(b)]) };
    const result = await new CommerceMetrics(env, pools, redis as unknown as Redis).readAll();
    expect(result.totals).toEqual({ holds: { created: 5, lock_busy: 1 }, payments: { paid: 1 }, poolWaiting: 5 });
    const down = { scan: vi.fn().mockRejectedValue(new Error('down')) };
    expect((await new CommerceMetrics(env, pools, down as unknown as Redis).readAll()).isAvailable).toBe(false);
  });
});
