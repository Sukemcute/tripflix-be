import { randomUUID } from 'node:crypto';
import type { EventEnvelope } from '@tripflix/contracts';
import type { StreamName } from '@tripflix/event-bus';
import { describe, expect, it, vi } from 'vitest';
import { FeedEventsUseCases } from './feed-events.use-cases.js';
import type { FeedUseCases } from './feed.use-cases.js';

const POST_ID = randomUUID();

function setup(publish: () => Promise<string>) {
  const getDurations = vi.fn((_postIds: string[]) => Promise.resolve(new Map([[POST_ID, 8]])));
  const bus = { publish: vi.fn((_stream: StreamName, _event: EventEnvelope) => publish()) };
  return { getDurations, bus, events: new FeedEventsUseCases({ getDurations } as unknown as FeedUseCases, bus) };
}

describe('FeedEventsUseCases', () => {
  it('Redis lỗi khi ghi stream thì vẫn trả kết quả, không ném lỗi ra request của app', async () => {
    const { bus, events } = setup(() => Promise.reject(new Error('Redis sập')));

    const result = await events.record({
      events: [{ eventId: randomUUID(), type: 'view', postId: POST_ID, watchedMs: 4_000, surface: 'reels' }],
      viewerId: null,
      anonId: null,
    });

    expect(result).toEqual({ accepted: 1 });
    expect(bus.publish).toHaveBeenCalledTimes(1);
  });

  it('video 8 giây xem 4 giây là xem thật; chỉ hỏi feed thời lượng, không dựng thẻ', async () => {
    const { getDurations, bus, events } = setup(() => Promise.resolve('1-0'));

    await events.record({
      events: [{ eventId: randomUUID(), type: 'view', postId: POST_ID, watchedMs: 4_000, surface: 'post_detail' }],
      viewerId: randomUUID(),
      anonId: null,
    });

    expect(getDurations).toHaveBeenCalledWith([POST_ID]);
    expect(bus.publish.mock.calls[0]?.[1]).toMatchObject({ payload: { isQualified: true, durationSec: 8, surface: 'post_detail' } });
  });
});
