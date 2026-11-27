import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS } from '../../../platform/tokens.js';

export const JOB_KEYS = ['explore', 'suggest', 'recommend_build', 'recommend_purge'] as const;
export type JobKey = (typeof JOB_KEYS)[number];
export type JobTrigger = 'schedule' | 'manual';
export const JOB_OUTCOMES = ['running', 'succeeded', 'skipped', 'failed', 'cancelled'] as const;
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
  /** track trả true khi không chạy vì admin đang tạm dừng job (không ghi lịch sử). */
  isPaused?: boolean;
}

/** Ai dừng/tạm dừng job, lúc nào, vì sao. */
export interface JobStop {
  /** userId của quản trị viên */
  by: string;
  /** epoch ms */
  at: number;
  reason: string;
}

/** Lý do AbortSignal của lượt khi admin dừng khẩn cấp. */
export class JobCancelledError extends Error {
  constructor(readonly stop: JobStop) {
    super(`Dừng khẩn cấp: ${stop.reason}`);
    this.name = 'JobCancelledError';
  }
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
const pauseKey = (job: JobKey) => `discovery:job-paused:${job}`;
const cancelKey = (runId: string) => `discovery:job-cancel:${runId}`;
/** Lượt chạy ở process khác (worker) thấy lệnh dừng trong vòng nhịp này. */
const CANCEL_POLL_MS = 2_000;
const CANCEL_TTL_SECONDS = 3600;
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

  /**
   * Ghi "running", chạy fn, ghi kết quả. Redis lỗi chỉ log: không làm hỏng job. Lỗi của fn ném lại cho job xử lý.
   * Job đang tạm dừng thì không chạy, không ghi lịch sử (lịch chạy mỗi phút sẽ đẩy hết lịch sử thật ra ngoài).
   * fn nhận signal: admin dừng khẩn cấp (requestCancel, có thể từ process khác) thì signal bị huỷ trong vòng 2 giây;
   * fn tự kiểm ở chỗ dừng an toàn. Ném ra sau khi bị huỷ thì lượt ghi là "cancelled".
   */
  async track(job: JobKey, trigger: JobTrigger, fn: (signal: AbortSignal) => Promise<JobResult>): Promise<JobResult> {
    if (await this.getPause(job)) return { outcome: 'skipped', isPaused: true };
    const run: JobRun = { runId: randomUUID(), trigger, startedAt: Date.now(), finishedAt: null, outcome: 'running', durationMs: null, summary: null, error: null };
    const controller = new AbortController();
    await this.markAlive(run.runId);
    const heartbeat = setInterval(() => void this.markAlive(run.runId), ALIVE_REFRESH_MS);
    heartbeat.unref();
    const cancelPoll = setInterval(() => void this.checkCancel(run.runId, controller), CANCEL_POLL_MS);
    cancelPoll.unref();
    await this.save(job, run);
    try {
      const result = await fn(controller.signal);
      await this.finish(job, run, result.outcome, result.summary ?? null, result.error ?? null);
      return result;
    } catch (error) {
      const reason: unknown = controller.signal.aborted ? controller.signal.reason : error;
      const message = (reason instanceof Error ? reason.message : String(reason)).slice(0, 1000);
      await this.finish(job, run, controller.signal.aborted ? 'cancelled' : 'failed', null, message);
      throw error;
    } finally {
      clearInterval(heartbeat);
      clearInterval(cancelPoll);
    }
  }

  /** Admin đang tạm dừng job thì trả ai/lúc nào/vì sao. Redis lỗi coi như không tạm dừng: không làm job đứng vì Redis. */
  async getPause(job: JobKey): Promise<JobStop | null> {
    try {
      const raw = await this.redis.get(pauseKey(job));
      return raw ? (JSON.parse(raw) as JobStop) : null;
    } catch (err) {
      this.logger.warn({ err, job }, 'Đọc trạng thái tạm dừng job lỗi (Redis), coi như không tạm dừng');
      return null;
    }
  }

  /** Tạm dừng (không hết hạn, tới khi admin bấm tiếp tục) hoặc bỏ tạm dừng. Lỗi Redis ném ra để admin biết chưa lưu. */
  async setPause(job: JobKey, stop: JobStop | null): Promise<void> {
    if (stop === null) await this.redis.del(pauseKey(job));
    else await this.redis.set(pauseKey(job), JSON.stringify(stop));
  }

  /** Báo mọi lượt đang chạy của job dừng lại (process nào đang chạy cũng thấy, qua Redis). Trả số lượt đã báo. */
  async requestCancel(job: JobKey, stop: JobStop): Promise<number> {
    const running = (await this.list(job)).filter((r) => r.outcome === 'running');
    for (const run of running) await this.redis.set(cancelKey(run.runId), JSON.stringify(stop), 'EX', CANCEL_TTL_SECONDS);
    return running.length;
  }

  private async checkCancel(runId: string, controller: AbortController): Promise<void> {
    if (controller.signal.aborted) return;
    try {
      const raw = await this.redis.get(cancelKey(runId));
      if (raw) controller.abort(new JobCancelledError(JSON.parse(raw) as JobStop));
    } catch (err) {
      this.logger.warn({ err, runId }, 'Đọc lệnh dừng job lỗi (Redis), thử lại nhịp sau');
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
