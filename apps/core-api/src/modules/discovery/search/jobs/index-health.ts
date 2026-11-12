import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { Redis } from 'ioredis';
import type { CoreEnv } from '../../../../platform/env.js';
import { CORE_ENV, REDIS } from '../../../../platform/tokens.js';

const STREAM = 'discovery:index-health:v1';
const MINUTE = 60_000;
const SAMPLE_MS = 5 * MINUTE;
const OFFLINE_MS = 8 * MINUTE;
const WINDOW_MS = 24 * SAMPLE_MS;
export const EXPLORE_INDEX_INTERVAL_MS = 10 * MINUTE;

export const JOB_NAMES = ['explore', 'suggest'] as const;
export type IndexJob = (typeof JOB_NAMES)[number];
type Outcome = 'succeeded' | 'failed' | 'skipped';
export const JOB_STATUSES = [
  'pending',
  'running',
  'stuck',
  'overdue',
  'succeeded',
  'failed',
  'skipped',
  'unknown',
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];
export const HEALTH_STATUSES = ['healthy', 'attention', 'offline', 'unknown'] as const;
export type HealthStatus = (typeof HEALTH_STATUSES)[number];

interface JobState {
  startedAt: number;
  finishedAt: number | null;
  outcome: Outcome | null;
  lastSuccessAt: number | null;
  count: number | null;
}

interface Snapshot {
  id: string;
  name: string;
  jobs: Partial<Record<IndexJob, JobState>>;
  event?: { job: IndexJob; message: string };
}

interface Sample extends Snapshot {
  at: number;
}

function jobStatus(job: IndexJob, sample: Sample, now: number): JobStatus {
  if (now - sample.at >= OFFLINE_MS) return 'unknown';
  const state = sample.jobs[job];
  if (!state) return 'pending';
  if (!state.outcome) return now - state.startedAt >= EXPLORE_INDEX_INTERVAL_MS ? 'stuck' : 'running';
  if (job === 'explore' && now - state.startedAt >= EXPLORE_INDEX_INTERVAL_MS + SAMPLE_MS) return 'overdue';
  return state.outcome;
}

function healthStatus(sample: Sample | undefined, now: number): HealthStatus {
  if (!sample) return 'unknown';
  if (now - sample.at >= OFFLINE_MS) return 'offline';
  return JOB_NAMES.some((job) =>
    ['pending', 'failed', 'stuck', 'overdue'].includes(jobStatus(job, sample, now)),
  )
    ? 'attention'
    : 'healthy';
}

@Injectable()
export class IndexHealth implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(IndexHealth.name);
  private readonly id = randomUUID();
  private readonly name = hostname();
  private readonly jobs: Snapshot['jobs'] = {};
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(CORE_ENV) private readonly env: CoreEnv,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  onApplicationBootstrap() {
    if (this.env.APP_ROLE === 'api' || this.env.NODE_ENV === 'test') return;
    this.record();
    this.timer = setInterval(() => this.record(), SAMPLE_MS);
    this.timer.unref();
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  start(job: IndexJob, startedAt: number) {
    this.jobs[job] = {
      startedAt,
      finishedAt: null,
      outcome: null,
      lastSuccessAt: this.jobs[job]?.lastSuccessAt ?? null,
      count: this.jobs[job]?.count ?? null,
    };
    this.record({ job, message: 'Bắt đầu dựng chỉ mục' });
  }

  finish(job: IndexJob, startedAt: number, outcome: Outcome, count?: number, error?: unknown) {
    const finishedAt = Date.now();
    this.jobs[job] = {
      startedAt,
      finishedAt,
      outcome,
      lastSuccessAt: outcome === 'succeeded' ? finishedAt : (this.jobs[job]?.lastSuccessAt ?? null),
      count: count ?? this.jobs[job]?.count ?? null,
    };
    const errorMessage =
      error instanceof Error ? error.message : typeof error === 'string' ? error : 'Không có chi tiết lỗi';
    const message =
      outcome === 'failed'
        ? `Dựng chỉ mục lỗi. ${errorMessage}`
        : outcome === 'skipped'
          ? 'Bỏ lượt vì worker khác đang dựng chỉ mục'
          : `Dựng chỉ mục thành công. ${count ?? 0} mục trong ${finishedAt - startedAt} ms`;
    this.record({ job, message: message.slice(0, 1000) });
  }

  private record(event?: Snapshot['event']) {
    if (this.env.APP_ROLE === 'api' || this.env.NODE_ENV === 'test') return;
    const retentionMs = WINDOW_MS + OFFLINE_MS;
    const snapshot: Snapshot = { id: this.id, name: this.name, jobs: this.jobs, event };
    void this.redis
      .multi()
      .xadd(STREAM, 'MINID', '=', Date.now() - retentionMs, '*', 'snapshot', JSON.stringify(snapshot))
      .pexpire(STREAM, retentionMs)
      .exec()
      .then((results) => {
        const error = results?.find(([err]) => err)?.[0];
        if (error) throw error;
      })
      .catch((err: unknown) => this.logger.warn({ err }, 'Không ghi được trạng thái worker tìm kiếm'));
  }

  async read() {
    const entries = await this.redis.xrange(STREAM, String(Date.now() - WINDOW_MS - OFFLINE_MS), '+');
    const now = Date.now();
    const byWorker = new Map<string, Sample[]>();
    for (const [entryId, fields] of entries) {
      const snapshot = JSON.parse(fields[1]!) as Snapshot;
      const at = Number(entryId.split('-')[0]);
      const samples = byWorker.get(snapshot.id) ?? [];
      samples.push({ ...snapshot, at });
      byWorker.set(snapshot.id, samples);
    }

    const workers = [];
    for (const samples of byWorker.values()) {
      const last = samples.at(-1)!;
      if (last.at < now - WINDOW_MS) continue;
      let cursor = 0;
      const history = Array.from({ length: WINDOW_MS / SAMPLE_MS }, (_, index) => {
        const at = now - WINDOW_MS + (index + 1) * SAMPLE_MS;
        while (samples[cursor] && samples[cursor]!.at <= at) cursor++;
        return { at, status: healthStatus(samples[cursor - 1], at) };
      });
      workers.push({
        id: last.id,
        name: last.name,
        lastSeenAt: last.at,
        status: healthStatus(last, now),
        jobs: JOB_NAMES.map((job) => {
          const state = last.jobs[job];
          return {
            job,
            status: jobStatus(job, last, now),
            startedAt: state?.startedAt ?? null,
            finishedAt: state?.finishedAt ?? null,
            lastSuccessAt: state?.lastSuccessAt ?? null,
            count: state?.count ?? null,
            logs: samples
              .filter((sample) => sample.at >= now - WINDOW_MS && sample.event?.job === job)
              .map((sample) => {
                const run = sample.jobs[job];
                return {
                  at: sample.at,
                  message: sample.event!.message,
                  outcome: run?.outcome ?? null,
                  durationMs: run?.finishedAt ? run.finishedAt - run.startedAt : null,
                  count: run?.outcome === 'succeeded' ? run.count : null,
                };
              })
              .reverse(),
          };
        }),
        history,
      });
    }
    return { checkedAt: now, workers };
  }
}
