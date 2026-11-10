import { eventEnvelopeSchema, type EventEnvelope } from '@tripflix/contracts';
import { STREAMS } from '@tripflix/event-bus';

const REPLAY_STATE_TTL_SECONDS = 7 * 24 * 60 * 60;

interface ReplayRedis {
  xrange(key: string, start: string, end: string): Promise<[string, string[]][]>;
  hgetall(key: string): Promise<Record<string, string>>;
  hset(key: string, fields: Record<string, string>): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
}

interface ReplayOptions {
  baseDelayMs?: number;
  maxAttempts?: number;
  onError?: (error: unknown, event: EventEnvelope) => void;
}

export class DeadLetterReplayer {
  constructor(
    private readonly redis: ReplayRedis,
    private readonly router: { route(event: EventEnvelope): Promise<unknown> },
    private readonly now: () => number,
    private readonly options: ReplayOptions = {},
  ) {}

  async replayOnce(): Promise<{ replayed: number; failed: number; skipped: number }> {
    const counts = { replayed: 0, failed: 0, skipped: 0 };
    const entries = await this.redis.xrange(STREAMS.deadLetter, '-', '+');
    for (const [, fields] of entries) {
      const entry: Record<string, string> = {};
      for (let index = 0; index < fields.length; index += 2) {
        entry[fields[index]!] = fields[index + 1]!;
      }
      if (entry.group !== 'notification') continue;

      let event: EventEnvelope;
      try {
        event = eventEnvelopeSchema.parse(JSON.parse(entry.event ?? ''));
      } catch {
        counts.skipped += 1;
        continue;
      }

      const stateKey = `notification:dlq:${event.eventId}`;
      const state = await this.redis.hgetall(stateKey);
      const attempts = Number(state.attempts ?? 0);
      if (state.status === 'done' || attempts >= (this.options.maxAttempts ?? 8)
        || this.now() < Number(state.nextAt ?? 0)) {
        counts.skipped += 1;
        continue;
      }

      try {
        await this.router.route(event);
      } catch (error) {
        await this.redis.hset(stateKey, {
          attempts: String(attempts + 1),
          nextAt: String(this.now() + (this.options.baseDelayMs ?? 5 * 60_000) * 2 ** attempts),
          status: 'pending',
        });
        await this.redis.expire(stateKey, REPLAY_STATE_TTL_SECONDS);
        counts.failed += 1;
        // Lỗi ghi log không được chặn các sự kiện còn lại.
        try {
          this.options.onError?.(error, event);
        } catch {
          // Redis đã giữ lịch thử lại nên có thể tiếp tục.
        }
        continue;
      }
      await this.redis.hset(stateKey, { attempts: String(attempts), nextAt: '0', status: 'done' });
      await this.redis.expire(stateKey, REPLAY_STATE_TTL_SECONDS);
      counts.replayed += 1;
    }
    return counts;
  }
}
