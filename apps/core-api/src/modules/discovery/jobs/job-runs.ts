import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS } from '../../../platform/tokens.js';

export const JOB_KEYS = ['explore', 'suggest', 'recommend_build', 'recommend_purge'] as const;
export type JobKey = (typeof JOB_KEYS)[number];
export type JobTrigger = 'schedule' | 'manual';
export const JOB_OUTCOMES = ['running', 'succeeded', 'skipped', 'failed'] as const;
export type JobOutcome = (typeof JOB_OUTCOMES)[number];

export interface JobSummary {
  count?: number;
  posts?: number;
  users?: number;
  deleted?: number;
  failedBuilders?: string[];
}

export interface JobRun {
  runId: string;
  trigger: JobTrigger;
  startedAt: number;
  finishedAt: number | null;
  outcome: JobOutcome;
  durationMs: number | null;
  summary: JobSummary | null;
  error: string | null;
}

/** Kết quả thân job trả cho track: chạy xong, hoặc bỏ lượt (worker khác giữ khoá). Lỗi thì ném. */
export interface JobResult {
  outcome: 'succeeded' | 'skipped';
  summary?: JobSummary;
  error?: string;
}

/** Job có chu kỳ admin đổi được đọc lại chu kỳ mỗi nhịp này: đổi có hiệu lực trong vòng một nhịp, không cần khởi động lại. */
export const SCHEDULE_TICK_MS = 60_000;

/**
 * Đến lượt chạy chưa. Chừa nửa nhịp: lượt trước ghi giờ bắt đầu trễ vài ms sau nhịp (chờ Redis), so `>=` đúng
 * chu kỳ thì lượt sau trượt thêm một nhịp (10 phút thành 11). Chạy tay lệch nhịp thì lượt sau có thể sớm tối đa nửa nhịp.
 */
export const isDue = (lastStartedAt: number, intervalMs: number, now = Date.now()) =>
  now - lastStartedAt >= intervalMs - SCHEDULE_TICK_MS / 2;

const KEEP = 20;
const TTL_SECONDS = 7 * 24 * 3600;
const key = (job: JobKey) => `discovery:job-runs:${job}`;
const intervalKey = (job: JobKey) => `discovery:job-interval:${job}`;
const aliveKey = (runId: string) => `discovery:job-run-alive:${runId}`;
// Làm mới mỗi 30 giây, hết hạn sau 2 phút: event loop nghẽn hay Redis chập chờn vài nhịp vẫn chưa bị coi là chết.
// Lỡ coi nhầm thì lúc lượt đó chạy xong, finish ghi đè lại kết quả thật.
const ALIVE_REFRESH_MS = 30_000;
const ALIVE_TTL_SECONDS = 120;
const ORPHAN_ERROR = 'Bị ngắt: tiến trình dừng giữa chừng (deploy/restart)';

/** Lịch sử 20 lần chạy gần nhất của mỗi job discovery (Redis hash runId → JSON), cho trang admin theo dõi. */
@Injectable()
export class JobRuns {
  private readonly logger = new Logger(JobRuns.name);

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /** Ghi "running", chạy fn, ghi kết quả. Redis lỗi chỉ log: không làm hỏng job. Lỗi của fn ném lại cho job xử lý. */
  async track(job: JobKey, trigger: JobTrigger, fn: () => Promise<JobResult>): Promise<JobResult> {
    const run: JobRun = { runId: randomUUID(), trigger, startedAt: Date.now(), finishedAt: null, outcome: 'running', durationMs: null, summary: null, error: null };
    await this.markAlive(run.runId);
    const heartbeat = setInterval(() => void this.markAlive(run.runId), ALIVE_REFRESH_MS);
    heartbeat.unref();
    await this.save(job, run);
    try {
      const result = await fn();
      await this.finish(job, run, result.outcome, result.summary ?? null, result.error ?? null);
      return result;
    } catch (error) {
      await this.finish(job, run, 'failed', null, (error instanceof Error ? error.message : String(error)).slice(0, 1000));
      throw error;
    } finally {
      clearInterval(heartbeat);
    }
  }

  /** Chu kỳ admin đặt cho job (ms). Chưa đặt, giá trị hỏng hay Redis lỗi thì `fallback`: job vẫn chạy theo mặc định. */
  async getIntervalMs(job: JobKey, fallback: number): Promise<number> {
    try {
      const value = Number(await this.redis.get(intervalKey(job)));
      return Number.isInteger(value) && value > 0 ? value : fallback;
    } catch (err) {
      this.logger.warn({ err, job }, 'Đọc chu kỳ job lỗi (Redis), dùng mặc định');
      return fallback;
    }
  }

  /** Đặt chu kỳ (ms) cho job; null = về mặc định. Không hết hạn. Lỗi Redis ném ra để admin biết chưa lưu được. */
  async setIntervalMs(job: JobKey, intervalMs: number | null): Promise<void> {
    if (intervalMs === null) await this.redis.del(intervalKey(job));
    else await this.redis.set(intervalKey(job), String(intervalMs));
  }

  /** Mới nhất trước. Lượt "running" mà tiến trình chạy nó đã chết (hết khoá sống) được ghi lại thành failed. */
  async list(job: JobKey): Promise<JobRun[]> {
    const raw = await this.redis.hvals(key(job));
    const runs = raw
      .map((v) => JSON.parse(v) as JobRun)
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, KEEP);
    return Promise.all(runs.map((run) => (run.outcome === 'running' ? this.failIfOrphaned(job, run) : run)));
  }

  /**
   * Tiến trình chết giữa track (deploy, restart) thì lượt kẹt "running" mãi. Khoá sống theo từng lượt chứ không dọn lúc
   * khởi động: nhiều bản core-api (scale API, tách worker) có thể cùng chạy job, dọn lúc boot sẽ đè lượt của bản khác còn sống.
   */
  private async failIfOrphaned(job: JobKey, run: JobRun): Promise<JobRun> {
    if (await this.redis.exists(aliveKey(run.runId))) return run;
    const finishedAt = Date.now();
    const orphan: JobRun = { ...run, finishedAt, outcome: 'failed', durationMs: finishedAt - run.startedAt, error: ORPHAN_ERROR };
    await this.save(job, orphan);
    return orphan;
  }

  private async markAlive(runId: string): Promise<void> {
    try {
      await this.redis.set(aliveKey(runId), '1', 'EX', ALIVE_TTL_SECONDS);
    } catch (err) {
      this.logger.warn({ err, runId }, 'Ghi khoá sống của job lỗi (Redis), job vẫn chạy');
    }
  }

  private finish(job: JobKey, run: JobRun, outcome: JobOutcome, summary: JobSummary | null, error: string | null) {
    const finishedAt = Date.now();
    return this.save(job, { ...run, finishedAt, outcome, durationMs: finishedAt - run.startedAt, summary, error });
  }

  private async save(job: JobKey, run: JobRun): Promise<void> {
    try {
      const k = key(job);
      await this.redis.multi().hset(k, run.runId, JSON.stringify(run)).expire(k, TTL_SECONDS).exec();
      const stale = (await this.redis.hvals(k))
        .map((v) => JSON.parse(v) as JobRun)
        .sort((a, b) => b.startedAt - a.startedAt)
        .slice(KEEP)
        .map((r) => r.runId);
      if (stale.length) await this.redis.hdel(k, ...stale);
    } catch (err) {
      this.logger.warn({ err, job }, 'Ghi lịch sử chạy job lỗi (Redis), job vẫn chạy');
    }
  }
}
