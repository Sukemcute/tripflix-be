import type { EventEnvelope } from '@tripflix/contracts';
import type { Redis } from 'ioredis';
import type { CoreEnv } from '../../../platform/env.js';
import type { RecommendIngestUseCases } from '../recommend/application/ingest.use-cases.js';
import type { ExploreUseCases } from '../search/application/explore.use-cases.js';
import { DiscoveryEventsConsumer } from './discovery-events.consumer.js';

const event = (type: string, payload: unknown) => ({ eventId: 'e1', type, payload }) as unknown as EventEnvelope;

describe('DiscoveryEventsConsumer', () => {
  const setup = () => {
    const calls: string[] = [];
    const dropHidden = vi.fn(async () => {
      calls.push('search');
      return 1;
    });
    const ingest = vi.fn(async () => {
      calls.push('recommend');
    });
    const consumer = new DiscoveryEventsConsumer(
      { APP_ROLE: 'api' } as CoreEnv,
      {} as Redis,
      { dropHidden } as unknown as ExploreUseCases,
      { ingest } as unknown as RecommendIngestUseCases,
    );
    return { consumer, dropHidden, ingest, calls };
  };

  it.each(['content.post.moderated', 'content.post.deleted', 'content.post.updated'])('%s: hỏi lại và gỡ bài nếu đã ẩn', async (type) => {
    const { consumer, dropHidden } = setup();
    await consumer.route(event(type, { postId: 'p1', action: 'restore' }));
    expect(dropHidden).toHaveBeenCalledWith(['p1']);
  });

  it.each([
    ['sự kiện khác của content', event('content.comment.created', { postId: 'p1' })],
    ['payload thiếu postId', event('content.post.deleted', {})],
    ['payload null', event('content.post.moderated', null)],
  ])('%s: search bỏ qua, không lỗi', async (_name, e) => {
    const { consumer, dropHidden } = setup();
    await expect(consumer.route(e)).resolves.toBeUndefined();
    expect(dropHidden).not.toHaveBeenCalled();
  });

  it('mọi sự kiện đi qua search rồi recommend, lần lượt', async () => {
    const { consumer, ingest, calls } = setup();
    const e = event('content.post.deleted', { postId: 'p1' });
    await consumer.route(e);
    expect(calls).toEqual(['search', 'recommend']);
    expect(ingest).toHaveBeenCalledWith(e);
    await consumer.route(event('commerce.order.paid', {}));
    expect(calls).toEqual(['search', 'recommend', 'recommend']);
  });

  it('bên nào lỗi cũng ném (không XACK); search lỗi thì chưa chạy recommend', async () => {
    const { consumer, dropHidden, ingest } = setup();
    ingest.mockRejectedValueOnce(new Error('db down'));
    await expect(consumer.route(event('content.reaction.updated', {}))).rejects.toThrow('db down');
    dropHidden.mockRejectedValueOnce(new Error('search down'));
    ingest.mockClear();
    await expect(consumer.route(event('content.post.deleted', { postId: 'p1' }))).rejects.toThrow('search down');
    expect(ingest).not.toHaveBeenCalled();
  });

  it('APP_ROLE=api: không bật consumer', () => {
    const { consumer } = setup();
    consumer.onApplicationBootstrap();
    expect((consumer as unknown as { consumer?: unknown }).consumer).toBeUndefined();
  });
});
