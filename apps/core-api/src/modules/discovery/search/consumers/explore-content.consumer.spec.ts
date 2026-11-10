import type { EventEnvelope } from '@tripflix/contracts';
import type { Redis } from 'ioredis';
import type { CoreEnv } from '../../../../platform/env.js';
import type { ExploreUseCases } from '../application/explore.use-cases.js';
import { ExploreContentConsumer } from './explore-content.consumer.js';

const event = (type: string, payload: unknown) => ({ eventId: 'e1', type, payload }) as unknown as EventEnvelope;

describe('ExploreContentConsumer', () => {
  const setup = () => {
    const dropHidden = vi.fn().mockResolvedValue(1);
    const consumer = new ExploreContentConsumer({ APP_ROLE: 'api' } as CoreEnv, {} as Redis, { dropHidden } as unknown as ExploreUseCases);
    return { consumer, dropHidden };
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
  ])('%s: bỏ qua, không lỗi', async (_name, e) => {
    const { consumer, dropHidden } = setup();
    await expect(consumer.route(e)).resolves.toBeUndefined();
    expect(dropHidden).not.toHaveBeenCalled();
  });

  it('APP_ROLE=api: không bật consumer', () => {
    const { consumer } = setup();
    consumer.onApplicationBootstrap();
    expect((consumer as unknown as { consumer?: unknown }).consumer).toBeUndefined();
  });
});
