import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { EventEnvelope } from '@tripflix/contracts';
import { RedisStreamsEventBus, RedisStreamsConsumer, STREAMS } from '@tripflix/event-bus';
import { startRedis, type RedisFixture } from '@tripflix/testing';
import { Redis } from 'ioredis';
import { MemoryMailer } from '../outapp/mailer.js';
import { EventRouter, RedisProcessedEvents } from './event-router.js';

// Đường đi thật: XADD vào stream:core.access → consumer group notification → EventRouter → email.
describe('notification consumer trên Redis thật', () => {
  let fixture: RedisFixture;
  let redis: Redis;

  beforeAll(async () => {
    fixture = await startRedis();
    redis = new Redis(fixture.url);
  });

  afterAll(async () => {
    redis?.disconnect();
    await fixture?.stop();
  });

  it('nhận access.password_reset_requested, gửi đúng 1 email dù sự kiện bị phát lại', async () => {
    const mailer = new MemoryMailer();
    const router = new EventRouter(mailer, new RedisProcessedEvents(redis), () => undefined);
    const consumer = new RedisStreamsConsumer({
      redis: redis.duplicate(),
      group: 'notification',
      consumer: 'test-replica',
      streams: [STREAMS.access],
      handler: async (event) => {
        await router.route(event);
      },
      blockMs: 50,
    });
    await consumer.ensureGroups();

    const event: EventEnvelope = {
      eventId: randomUUID(),
      type: 'access.password_reset_requested',
      version: 1,
      occurredAt: new Date().toISOString(),
      producer: 'core-api/access',
      userId: null,
      payload: {
        userId: randomUUID(),
        email: 'khang@example.com',
        displayName: 'Khang',
        resetUrl: 'http://localhost:3100/dat-lai-mat-khau?token=abc',
        expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      },
    };
    const bus = new RedisStreamsEventBus(redis);
    await bus.publish(STREAMS.access, event);
    // Relay có thể gửi trùng (giao ít nhất một lần): phát lại cùng eventId.
    await bus.publish(STREAMS.access, event);

    await consumer.pollOnce();
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]).toMatchObject({ to: 'khang@example.com', subject: 'Đặt lại mật khẩu Tripflix' });
    expect(((await redis.xpending(STREAMS.access, 'notification')) as [number])[0]).toBe(0);
  });
});
