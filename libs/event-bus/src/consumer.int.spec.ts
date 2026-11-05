import { randomUUID } from 'node:crypto';
import type { EventEnvelope } from '@tripflix/contracts';
import { startRedis, type RedisFixture } from '@tripflix/testing';
import { Redis } from 'ioredis';
import { RedisStreamsConsumer, type EventHandler } from './consumer.js';
import { RedisStreamsEventBus, STREAMS, type StreamName } from './index.js';

function createEvent(type = 'access.user.registered'): EventEnvelope {
  return {
    eventId: randomUUID(),
    type,
    version: 1,
    occurredAt: new Date().toISOString(),
    producer: 'test',
    userId: null,
    payload: {},
  };
}

describe('RedisStreamsConsumer trên Redis thật', () => {
  let fixture: RedisFixture;
  let redis: Redis;
  let bus: RedisStreamsEventBus;

  beforeAll(async () => {
    fixture = await startRedis();
    redis = new Redis(fixture.url);
    bus = new RedisStreamsEventBus(redis);
  });

  afterAll(async () => {
    redis?.disconnect();
    await fixture?.stop();
  });

  beforeEach(async () => {
    await redis.flushall();
  });

  function createConsumer(handler: EventHandler, streams: StreamName[] = [STREAMS.access]) {
    return new RedisStreamsConsumer({
      redis: redis.duplicate(),
      group: 'notification',
      consumer: 'replica-1',
      streams,
      handler,
      blockMs: 50,
      claimIdleMs: 50,
      maxDeliveries: 3,
    });
  }

  const pendingCount = async (stream: StreamName) =>
    ((await redis.xpending(stream, 'notification')) as [number])[0];

  it('xử lý cả sự kiện phát trước khi group được tạo, xong thì XACK', async () => {
    const before = createEvent();
    await bus.publish(STREAMS.access, before);
    const seen: string[] = [];
    const consumer = createConsumer(async (e) => {
      seen.push(e.eventId);
    });
    await consumer.ensureGroups();
    await bus.publish(STREAMS.access, createEvent());

    expect(await consumer.pollOnce()).toBe(2);
    expect(seen[0]).toBe(before.eventId);
    expect(await pendingCount(STREAMS.access)).toBe(0);
  });

  it('nghe nhiều stream cùng lúc', async () => {
    const seen: string[] = [];
    const consumer = createConsumer(async (e) => {
      seen.push(e.type);
    }, [STREAMS.access, STREAMS.content]);
    await consumer.ensureGroups();
    await bus.publish(STREAMS.access, createEvent('access.user.registered'));
    await bus.publish(STREAMS.content, createEvent('media.transcode_requested'));
    await consumer.pollOnce();
    expect(seen.sort()).toEqual(['access.user.registered', 'media.transcode_requested']);
  });

  it('handler lỗi thì không XACK; hết claimIdleMs thì được giao lại và xử lý được', async () => {
    let attempts = 0;
    const consumer = createConsumer(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('SMTP tạm lỗi');
    });
    await consumer.ensureGroups();
    await bus.publish(STREAMS.access, createEvent());

    expect(await consumer.pollOnce()).toBe(0);
    expect(await pendingCount(STREAMS.access)).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(await consumer.pollOnce()).toBe(1);
    expect(attempts).toBe(2);
    expect(await pendingCount(STREAMS.access)).toBe(0);
  });

  it('lỗi quá maxDeliveries thì chuyển sang stream:dead-letter và XACK', async () => {
    const consumer = createConsumer(async () => {
      throw new Error('luôn lỗi');
    });
    await consumer.ensureGroups();
    const event = createEvent();
    await bus.publish(STREAMS.access, event);

    for (let i = 0; i < 5; i += 1) {
      await consumer.pollOnce();
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    expect(await pendingCount(STREAMS.access)).toBe(0);
    const dead = await redis.xrange(STREAMS.deadLetter, '-', '+');
    expect(dead).toHaveLength(1);
    const fields = dead[0]![1];
    expect(JSON.parse(fields[fields.indexOf('event') + 1]!).eventId).toBe(event.eventId);
    expect(fields[fields.indexOf('reason') + 1]).toMatch(/Giao quá 3 lần/);
  });

  it('sự kiện không đọc được thì vào dead-letter ngay, không gọi handler', async () => {
    const handler = vi.fn(async () => undefined);
    const consumer = createConsumer(handler);
    await consumer.ensureGroups();
    await redis.xadd(STREAMS.access, '*', 'event', '{không phải json');
    await consumer.pollOnce();
    expect(handler).not.toHaveBeenCalled();
    expect(await redis.xlen(STREAMS.deadLetter)).toBe(1);
  });

  it('tạo group lần hai không lỗi; start/stop chạy vòng lặp', async () => {
    const seen: string[] = [];
    const consumer = createConsumer(async (e) => {
      seen.push(e.eventId);
    });
    await consumer.ensureGroups();
    await consumer.start();
    const event = createEvent();
    await bus.publish(STREAMS.access, event);
    await vi.waitFor(() => expect(seen).toContain(event.eventId), { timeout: 3_000 });
    await consumer.stop();
  });
});
