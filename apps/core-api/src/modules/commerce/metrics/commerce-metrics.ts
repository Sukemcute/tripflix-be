import { hostname } from 'node:os';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { DEFAULT_POOL_SIZE, setPoolMax } from '@tripflix/db';
import type { Redis } from 'ioredis';
import type { CoreEnv } from '../../../platform/env.js';
import { CORE_ENV, DB_POOLS, REDIS, type DbPools } from '../../../platform/tokens.js';
import { computePoolCap, decidePoolMax, type AutoscaleState } from './pool-autoscale.js';

/** Mỗi instance ghi một khoá; khoá tự hết hạn nên instance đã tắt không còn trong tổng. */
export const METRICS_KEY_PREFIX = 'commerce:metrics:';
const PUBLISH_EVERY_MS = 5_000;
const KEY_TTL_SECONDS = 30;
/** Lấy mẫu số request chờ kết nối 4 lần/giây: một lần đo mỗi 5 giây dễ trượt lúc pool đang dồn. */
const SAMPLE_WAITING_EVERY_MS = 250;

export type HoldOutcome = 'created' | 'sold_out' | 'lock_busy' | 'rate_limited' | 'rejected' | 'error';
export type PayOutcome = 'paid' | 'requires_action' | 'pending' | 'failed' | 'rejected' | 'error';

/** Số đo một instance ghi vào Redis mỗi 5 giây; bộ đếm là số trong 5 giây vừa qua. */
export interface InstanceMetrics {
  instance: string;
  role: string;
  at: string;
  windowSeconds: number;
  /** waiting: số request chờ kết nối cao nhất trong 5 giây; max: số kết nối tối đa hiện tại (có thể đã tự tăng). */
  pool: { total: number; idle: number; waiting: number; max: number };
  eventLoopDelayP99Ms: number;
  holds: Partial<Record<HoldOutcome, number>>;
  payments: Partial<Record<PayOutcome, number>>;
}

/**
 * Số đo vận hành của commerce (D1 phần 3, rà soát 13/11): trước đây muốn biết pool có thiếu, event loop có nghẽn,
 * giữ chỗ và trả tiền đang thành công bao nhiêu thì phải tự viết script đo. Mỗi instance đẩy số của mình vào Redis để
 * cộng được trên toàn hệ thống (nhiều instance), và tự chỉnh pool commerce theo tải (adjustPool, L4).
 * Redis lỗi thì bỏ qua lượt đó: số đo không bao giờ được làm hỏng luồng đặt chỗ.
 */
@Injectable()
export class CommerceMetrics implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(CommerceMetrics.name);
  private readonly instance = `${hostname()}:${process.pid}`;
  private holds: Partial<Record<HoldOutcome, number>> = {};
  private payments: Partial<Record<PayOutcome, number>> = {};
  private loopDelay?: ReturnType<typeof monitorEventLoopDelay>;
  private timer?: NodeJS.Timeout;
  private isRedisDown = false;
  private sampler?: NodeJS.Timeout;
  private peakWaiting = 0;
  private autoscale: AutoscaleState = { busyWindows: 0, calmWindows: 0 };
  private readonly basePoolSize = DEFAULT_POOL_SIZE.commerce;

  constructor(
    @Inject(CORE_ENV) private readonly env: CoreEnv,
    @Inject(DB_POOLS) private readonly pools: DbPools,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  onApplicationBootstrap() {
    if (this.env.NODE_ENV === 'test') return;
    this.loopDelay = monitorEventLoopDelay({ resolution: 20 });
    this.loopDelay.enable();
    this.timer = setInterval(() => void this.publish(), PUBLISH_EVERY_MS);
    this.timer.unref();
    this.sampler = setInterval(() => {
      this.peakWaiting = Math.max(this.peakWaiting, this.pools.commerce.waitingCount);
    }, SAMPLE_WAITING_EVERY_MS);
    this.sampler.unref();
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
    if (this.sampler) clearInterval(this.sampler);
    this.loopDelay?.disable();
  }

  countHold(outcome: HoldOutcome) {
    this.holds[outcome] = (this.holds[outcome] ?? 0) + 1;
  }

  countPayment(outcome: PayOutcome) {
    this.payments[outcome] = (this.payments[outcome] ?? 0) + 1;
  }

  /** Lấy số của 5 giây vừa qua rồi đặt lại bộ đếm. */
  snapshot(): InstanceMetrics {
    const pool = this.pools.commerce;
    const metrics: InstanceMetrics = {
      instance: this.instance,
      role: this.env.APP_ROLE,
      at: new Date().toISOString(),
      windowSeconds: PUBLISH_EVERY_MS / 1000,
      pool: { total: pool.totalCount, idle: pool.idleCount, waiting: Math.max(this.peakWaiting, pool.waitingCount), max: pool.options.max ?? 0 },
      eventLoopDelayP99Ms: this.loopDelay ? Math.round(this.loopDelay.percentile(99) / 1e6) : 0,
      holds: this.holds,
      payments: this.payments,
    };
    this.holds = {};
    this.payments = {};
    this.peakWaiting = 0;
    this.loopDelay?.reset();
    return metrics;
  }

  async publish(): Promise<void> {
    const metrics = this.snapshot();
    try {
      await this.redis.set(`${METRICS_KEY_PREFIX}${this.instance}`, JSON.stringify(metrics), 'EX', KEY_TTL_SECONDS);
      if (this.isRedisDown) this.logger.log('Ghi số đo commerce vào Redis chạy lại');
      this.isRedisDown = false;
      if (this.env.COMMERCE_POOL_AUTOSCALE) this.adjustPool(metrics, (await this.listMetricKeys()).length);
    } catch (error) {
      // Báo một lần khi bắt đầu lỗi, không dội log mỗi 5 giây.
      if (!this.isRedisDown) this.logger.warn({ err: error }, 'Không ghi được số đo commerce vào Redis, bỏ qua');
      this.isRedisDown = true;
      // Không biết có bao nhiêu bản đang chạy thì không chia được ngân sách: về mức mặc định cho an toàn.
      if (this.env.COMMERCE_POOL_AUTOSCALE) this.applyPoolMax(this.basePoolSize, metrics.pool.max, 'Redis lỗi, không đếm được số bản');
    }
  }

  /** Tự tăng, giảm pool commerce theo số đo (L4); trần chia theo số bản core-api đang ghi số đo vào Redis. */
  adjustPool(metrics: InstanceMetrics, instances: number) {
    const cap = computePoolCap({ base: this.basePoolSize, budget: this.env.COMMERCE_POOL_BUDGET, ceiling: this.env.COMMERCE_POOL_CEILING, instances });
    const { next, state } = decidePoolMax({
      current: metrics.pool.max,
      base: this.basePoolSize,
      cap,
      waiting: metrics.pool.waiting,
      eventLoopDelayP99Ms: metrics.eventLoopDelayP99Ms,
      state: this.autoscale,
    });
    this.autoscale = state;
    this.applyPoolMax(next, metrics.pool.max, `chờ kết nối ${metrics.pool.waiting}, event loop p99 ${metrics.eventLoopDelayP99Ms} ms, ${instances} bản, trần ${cap}`);
  }

  private applyPoolMax(next: number, current: number, reason: string) {
    if (next === current) return;
    const applied = setPoolMax(this.pools.commerce, next, { min: this.basePoolSize, max: Math.max(this.basePoolSize, this.env.COMMERCE_POOL_CEILING) });
    this.logger.log({ from: current, to: applied, reason }, applied > current ? 'Tăng pool commerce' : 'Giảm pool commerce');
  }

  private async listMetricKeys(): Promise<string[]> {
    const keys: string[] = [];
    let cursor = '0';
    do {
      const [next, batch] = await this.redis.scan(cursor, 'MATCH', `${METRICS_KEY_PREFIX}*`, 'COUNT', 100);
      cursor = next;
      keys.push(...batch);
    } while (cursor !== '0');
    return keys;
  }

  /** Số đo mới nhất của mọi instance còn sống, kèm tổng. Redis lỗi thì báo không đọc được, không ném lỗi. */
  async readAll(): Promise<{ isAvailable: boolean; instances: InstanceMetrics[]; totals: { holds: Partial<Record<HoldOutcome, number>>; payments: Partial<Record<PayOutcome, number>>; poolWaiting: number } }> {
    const totals = { holds: {} as Partial<Record<HoldOutcome, number>>, payments: {} as Partial<Record<PayOutcome, number>>, poolWaiting: 0 };
    try {
      const keys = await this.listMetricKeys();
      const values = keys.length ? await this.redis.mget(...keys) : [];
      const instances = values.flatMap((v) => (v ? [JSON.parse(v) as InstanceMetrics] : []));
      for (const m of instances) {
        for (const [k, n] of Object.entries(m.holds)) totals.holds[k as HoldOutcome] = (totals.holds[k as HoldOutcome] ?? 0) + (n ?? 0);
        for (const [k, n] of Object.entries(m.payments)) totals.payments[k as PayOutcome] = (totals.payments[k as PayOutcome] ?? 0) + (n ?? 0);
        totals.poolWaiting += m.pool.waiting;
      }
      return { isAvailable: true, instances, totals };
    } catch {
      return { isAvailable: false, instances: [], totals };
    }
  }
}
