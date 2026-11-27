import { describe, expect, it, vi } from 'vitest';
import type { Redis } from 'ioredis';
import type { CoreEnv } from '../../../platform/env.js';
import type { DbPools } from '../../../platform/tokens.js';
import { AdmissionGate } from '../platform/admission-gate.js';
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
    expect(first.admission).toEqual({ browseInFlight: 0, txInFlight: 0, txWaiting: 0, browseRejected: 0, txRejected: 0, txQueuedTotal: 0, txWaitMsMax: 0 });
    expect(metrics.snapshot().holds).toEqual({});
  });

  it('công bố snapshot thật của bộ cấp suất mà không đặt lại bộ đếm tích luỹ', async () => {
    vi.useFakeTimers();
    try {
      const gate = new AdmissionGate({ total: 3, txReserved: 1, txQueueMax: 1, txWaitMs: 2_000 });
      expect(gate.tryBrowse()).toBe(true);
      expect(gate.tryBrowse()).toBe(true);
      expect(gate.tryBrowse()).toBe(false);
      await expect(gate.acquireTx()).resolves.toBe(true);
      const waiting = gate.acquireTx();
      await expect(gate.acquireTx()).resolves.toBe(false);
      await vi.advanceTimersByTimeAsync(17);
      gate.release('browse');
      await expect(waiting).resolves.toBe(true);

      const set = vi.fn().mockResolvedValue('OK');
      const zadd = vi.fn().mockResolvedValue(1);
      const zremrangebyscore = vi.fn().mockResolvedValue(0);
      const metrics = new CommerceMetrics(env, pools, { set, zadd, zremrangebyscore } as unknown as Redis, gate);
      const admission = { browseInFlight: 1, txInFlight: 2, txWaiting: 0, browseRejected: 1, txRejected: 1, txQueuedTotal: 1, txWaitMsMax: 17 };

      expect(metrics.snapshot().admission).toEqual(admission);
      expect(metrics.snapshot().admission).toEqual(admission);
      expect(gate.snapshot()).toEqual(admission);
      await metrics.publish();
      expect(JSON.parse(set.mock.calls[0]![1] as string).admission).toEqual(admission);
    } finally {
      vi.useRealTimers();
    }
  });

  it('ghi vào Redis một khoá mỗi instance, có hạn 30 giây; dọn instance cũ khỏi set kể cả khi tắt autoscale', async () => {
    const set = vi.fn().mockResolvedValue('OK');
    const zadd = vi.fn().mockResolvedValue(1);
    const zremrangebyscore = vi.fn().mockResolvedValue(0);
    const metrics = new CommerceMetrics(env, pools, { set, zadd, zremrangebyscore } as unknown as Redis);
    await metrics.publish();
    expect(set).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`^${METRICS_KEY_PREFIX}`)), expect.any(String), 'EX', 30);
    expect(zadd).toHaveBeenCalledWith(`${METRICS_KEY_PREFIX}instances`, expect.any(Number), expect.any(String));
    expect(zremrangebyscore).toHaveBeenCalledWith(`${METRICS_KEY_PREFIX}instances`, 0, expect.any(Number));
  });

  it('Redis lỗi thì bỏ qua, không ném lỗi ra luồng đặt chỗ', async () => {
    const metrics = new CommerceMetrics(env, pools, { set: vi.fn().mockRejectedValue(new Error('redis down')) } as unknown as Redis);
    await expect(metrics.publish()).resolves.toBeUndefined();
  });

  it('readAll cộng số của mọi instance; Redis lỗi thì báo isAvailable=false', async () => {
    const a: Partial<InstanceMetrics> = { pool: { total: 10, idle: 0, waiting: 4, max: 10 }, holds: { created: 3 }, payments: { paid: 1 } };
    const b: Partial<InstanceMetrics> = { pool: { total: 5, idle: 5, waiting: 1, max: 10 }, holds: { created: 2, lock_busy: 1 }, payments: {} };
    const redis = {
      zremrangebyscore: vi.fn().mockResolvedValue(0),
      zrangebyscore: vi.fn().mockResolvedValue(['a', 'b']),
      mget: vi.fn().mockResolvedValue([JSON.stringify(a), JSON.stringify(b)]),
    };
    const result = await new CommerceMetrics(env, pools, redis as unknown as Redis).readAll();
    expect(result.totals).toEqual({
      holds: { created: 5, lock_busy: 1 }, payments: { paid: 1 }, poolWaiting: 5,
      admission: { browseInFlight: 0, txInFlight: 0, txWaiting: 0, browseRejected: 0, txRejected: 0, txQueuedTotal: 0, txWaitMsMax: 0 },
    });
    expect(redis.mget).toHaveBeenCalledWith(`${METRICS_KEY_PREFIX}a`, `${METRICS_KEY_PREFIX}b`);
    const down = { zremrangebyscore: vi.fn().mockRejectedValue(new Error('down')) };
    expect((await new CommerceMetrics(env, pools, down as unknown as Redis).readAll()).isAvailable).toBe(false);
  });

  it('cộng admission của bản mới cùng bản cũ và giữ thời gian chờ lớn nhất', async () => {
    const old: Partial<InstanceMetrics> = { pool: { total: 1, idle: 0, waiting: 1, max: 10 }, holds: { created: 1 }, payments: {} };
    const a: Partial<InstanceMetrics> = {
      pool: { total: 2, idle: 0, waiting: 2, max: 10 }, holds: { created: 2 }, payments: { paid: 1 },
      admission: { browseInFlight: 3, txInFlight: 4, txWaiting: 5, browseRejected: 6, txRejected: 7, txQueuedTotal: 8, txWaitMsMax: 900 },
    };
    const b: Partial<InstanceMetrics> = {
      pool: { total: 3, idle: 0, waiting: 3, max: 10 }, holds: {}, payments: { paid: 2 },
      admission: { browseInFlight: 1, txInFlight: 2, txWaiting: 3, browseRejected: 4, txRejected: 5, txQueuedTotal: 6, txWaitMsMax: 400 },
    };
    const redis = {
      zremrangebyscore: vi.fn().mockResolvedValue(0),
      zrangebyscore: vi.fn().mockResolvedValue(['old', 'a', 'b']),
      mget: vi.fn().mockResolvedValue([JSON.stringify(old), JSON.stringify(a), JSON.stringify(b)]),
    };

    const result = await new CommerceMetrics(env, pools, redis as unknown as Redis).readAll();

    expect(result.isAvailable).toBe(true);
    expect(result.instances).toEqual([old, a, b]);
    expect(result.totals).toEqual({
      holds: { created: 3 }, payments: { paid: 3 }, poolWaiting: 6,
      admission: { browseInFlight: 4, txInFlight: 6, txWaiting: 8, browseRejected: 10, txRejected: 12, txQueuedTotal: 14, txWaitMsMax: 900 },
    });
  });

  it('không đếm instance có score đã quá TTL', async () => {
    const now = 1_000_000;
    const dateNow = vi.spyOn(Date, 'now').mockReturnValue(now);
    try {
      const scores = new Map([['expired', now - 30_001]]);
      const set = vi.fn().mockResolvedValue('OK');
      const zadd = vi.fn((_key: string, score: number, instance: string) => {
        scores.set(instance, score);
        return Promise.resolve(1);
      });
      const zremrangebyscore = vi.fn((_key: string, min: number, max: number) => {
        for (const [instance, score] of scores) {
          if (score >= min && score <= max) scores.delete(instance);
        }
        return Promise.resolve(1);
      });
      const zcard = vi.fn(() => Promise.resolve(scores.size));
      const metrics = new CommerceMetrics(
        { ...env, COMMERCE_POOL_AUTOSCALE: true },
        pools,
        { set, zadd, zremrangebyscore, zcard } as unknown as Redis,
      );
      const adjustPool = vi.spyOn(metrics, 'adjustPool').mockImplementation(() => {});

      await metrics.publish();

      expect(scores.has('expired')).toBe(false);
      expect(zremrangebyscore).toHaveBeenCalledWith(`${METRICS_KEY_PREFIX}instances`, 0, now - 30_000);
      expect(adjustPool).toHaveBeenCalledWith(expect.any(Object), 1);
    } finally {
      dateNow.mockRestore();
    }
  });
});
