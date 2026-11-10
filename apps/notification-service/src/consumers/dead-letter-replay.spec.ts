import { randomUUID } from 'node:crypto';
import type { EventEnvelope } from '@tripflix/contracts';
import { STREAMS } from '@tripflix/event-bus';
import { DeadLetterReplayer } from './dead-letter-replay.js';

class MemoryReplayRedis {
  readonly entries: [string, string[]][] = [];
  readonly hashes = new Map<string, Record<string, string>>();
  readonly expirations = new Map<string, number>();

  async xrange(stream: string, start: string, end: string): Promise<[string, string[]][]> {
    expect([stream, start, end]).toEqual([STREAMS.deadLetter, '-', '+']);
    return this.entries;
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    return { ...this.hashes.get(key) };
  }

  async hset(key: string, fields: Record<string, string>): Promise<number> {
    const previous = this.hashes.get(key) ?? {};
    this.hashes.set(key, { ...previous, ...fields });
    return Object.keys(fields).filter((field) => !(field in previous)).length;
  }

  async expire(key: string, seconds: number): Promise<number> {
    this.expirations.set(key, seconds);
    return 1;
  }

  addEvent(event: EventEnvelope, group = 'notification'): void {
    this.entries.push([`${this.entries.length + 1}-0`, ['group', group, 'event', JSON.stringify(event)]]);
  }
}

function createEvent(): EventEnvelope {
  return {
    eventId: randomUUID(),
    type: 'commerce.order.paid',
    version: 1,
    occurredAt: new Date().toISOString(),
    producer: 'core-api/commerce',
    userId: null,
    payload: {},
  };
}

describe('DeadLetterReplayer', () => {
  it('gửi lại sự kiện đến hạn, lưu trạng thái xong để lần sau không gửi trùng', async () => {
    const redis = new MemoryReplayRedis();
    const event = createEvent();
    redis.addEvent(event);
    const route = vi.fn().mockResolvedValue('handled');
    const replayer = new DeadLetterReplayer(redis, { route }, () => 1_000);

    expect(await replayer.replayOnce()).toEqual({ replayed: 1, failed: 0, skipped: 0 });
    expect(route).toHaveBeenCalledWith(event);
    expect(redis.hashes.get(`notification:dlq:${event.eventId}`)?.status).toBe('done');
    expect(redis.expirations.get(`notification:dlq:${event.eventId}`)).toBe(604_800);
    expect(await replayer.replayOnce()).toEqual({ replayed: 0, failed: 0, skipped: 1 });
    expect(route).toHaveBeenCalledTimes(1);
  });

  it('bỏ qua sự kiện của group khác', async () => {
    const redis = new MemoryReplayRedis();
    redis.addEvent(createEvent(), 'analytics');
    const route = vi.fn();
    expect(await new DeadLetterReplayer(redis, { route }, () => 0).replayOnce())
      .toEqual({ replayed: 0, failed: 0, skipped: 0 });
    expect(route).not.toHaveBeenCalled();
    expect(redis.hashes.size).toBe(0);
  });

  it('lỗi thì chờ 5, 10 phút và chỉ thử lại khi đến hạn', async () => {
    const redis = new MemoryReplayRedis();
    const event = createEvent();
    redis.addEvent(event);
    const error = new Error('SMTP lỗi');
    const route = vi.fn().mockRejectedValue(error);
    const onError = vi.fn();
    let currentTime = 1_000;
    const replayer = new DeadLetterReplayer(redis, { route }, () => currentTime, { onError });
    const key = `notification:dlq:${event.eventId}`;

    expect(await replayer.replayOnce()).toEqual({ replayed: 0, failed: 1, skipped: 0 });
    expect(redis.hashes.get(key)).toMatchObject({ attempts: '1', nextAt: '301000' });
    expect(redis.expirations.get(key)).toBe(604_800);
    expect(onError).toHaveBeenCalledWith(error, event);
    currentTime = 300_999;
    expect(await replayer.replayOnce()).toEqual({ replayed: 0, failed: 0, skipped: 1 });
    expect(route).toHaveBeenCalledTimes(1);
    currentTime = 301_000;
    expect(await replayer.replayOnce()).toEqual({ replayed: 0, failed: 1, skipped: 0 });
    expect(redis.hashes.get(key)).toMatchObject({ attempts: '2', nextAt: '901000' });
    currentTime = 901_001;
    route.mockResolvedValueOnce('handled');
    expect(await replayer.replayOnce()).toEqual({ replayed: 1, failed: 0, skipped: 0 });
    expect(route).toHaveBeenCalledTimes(3);
  });

  it('dừng khi đủ maxAttempts dù đã đến hạn', async () => {
    const redis = new MemoryReplayRedis();
    const event = createEvent();
    redis.addEvent(event);
    let currentTime = 0;
    const route = vi.fn().mockRejectedValue(new Error('SMTP lỗi'));
    const replayer = new DeadLetterReplayer(redis, { route }, () => currentTime, { maxAttempts: 2, baseDelayMs: 10 });

    await replayer.replayOnce();
    currentTime = 10;
    await replayer.replayOnce();
    currentTime = 30;
    expect(await replayer.replayOnce()).toEqual({ replayed: 0, failed: 0, skipped: 1 });
    expect(route).toHaveBeenCalledTimes(2);
    expect(redis.hashes.get(`notification:dlq:${event.eventId}`)?.attempts).toBe('2');
  });

  it('bỏ qua JSON hỏng hoặc envelope sai mà vẫn xử lý sự kiện hợp lệ', async () => {
    const redis = new MemoryReplayRedis();
    redis.entries.push(['1-0', ['group', 'notification', 'event', '{']],
      ['2-0', ['group', 'notification', 'event', '{}']]);
    redis.addEvent(createEvent());
    const route = vi.fn().mockResolvedValue('handled');
    expect(await new DeadLetterReplayer(redis, { route }, () => 0).replayOnce())
      .toEqual({ replayed: 1, failed: 0, skipped: 2 });
    expect(route).toHaveBeenCalledTimes(1);
  });
});
