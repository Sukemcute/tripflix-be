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

const KEEP = 20;
const TTL_SECONDS = 7 * 24 * 3600;
const key = (job: JobKey) => `discovery:job-runs:${job}`;

/** Lịch sử 20 lần chạy gần nhất của mỗi job discovery (Redis hash runId → JSON), cho trang admin theo dõi. */
@Injectable()
export class JobRuns {
  private readonly logger = new Logger(JobRuns.name);

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /** Ghi "running", chạy fn, ghi kết quả. Redis lỗi chỉ log: không làm hỏng job. Lỗi của fn ném lại cho job xử lý. */
  async track(job: JobKey, trigger: JobTrigger, fn: () => Promise<JobResult>): Promise<JobResult> {
    const run: JobRun = { runId: randomUUID(), trigger, startedAt: Date.now(), finishedAt: null, outcome: 'running', durationMs: null, summary: null, error: null };
    await this.save(job, run);
    try {
      const result = await fn();
      await this.finish(job, run, result.outcome, result.summary ?? null, result.error ?? null);
      return result;
    } catch (error) {
      await this.finish(job, run, 'failed', null, (error instanceof Error ? error.message : String(error)).slice(0, 1000));
      throw error;
    }
  }

  /** Mới nhất trước. */
  async list(job: JobKey): Promise<JobRun[]> {
    const raw = await this.redis.hvals(key(job));
    return raw
      .map((v) => JSON.parse(v) as JobRun)
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, KEEP);
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
