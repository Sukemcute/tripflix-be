import { describe, expect, it, vi } from 'vitest';
import { STREAMS } from '@tripflix/event-bus';
import { ContentOutboxRelay } from './content-outbox-relay.js';

describe('ContentOutboxRelay', () => {
  const mockPools: any = {
    content: {},
  };
  const mockRedis: any = {};

  it('không khởi chạy relay nếu APP_ROLE không phải worker hoặc all', () => {
    const env: any = { APP_ROLE: 'api' };
    const relay = new ContentOutboxRelay(env, mockPools, mockRedis);
    relay.onApplicationBootstrap();
    expect((relay as any).relay).toBeUndefined();
  });

  it('định tuyến chính xác stream cho sự kiện media vs content', async () => {
    const env: any = { APP_ROLE: 'all' };
    const relay = new ContentOutboxRelay(env, mockPools, mockRedis);
    relay.onApplicationBootstrap();

    const relayInstance = (relay as any).relay;
    expect(relayInstance).toBeDefined();

    // Stream selector function từ options
    const streamFn = relayInstance.options.stream;
    expect(typeof streamFn).toBe('function');

    expect(streamFn({ type: 'media.asset_uploaded' } as any)).toBe(STREAMS.media);
    expect(streamFn({ type: 'media.transcode_completed' } as any)).toBe(STREAMS.media);
    expect(streamFn({ type: 'content.media.transcode_requested' } as any)).toBe(STREAMS.media);
    expect(streamFn({ type: 'content.post.published' } as any)).toBe(STREAMS.content);
    expect(streamFn({ type: 'content.post.deleted' } as any)).toBe(STREAMS.content);
    expect(streamFn({ type: 'content.comment.created' } as any)).toBe(STREAMS.content);
    expect(streamFn({ type: 'content.reaction.updated' } as any)).toBe(STREAMS.content);

    await relay.onApplicationShutdown();
  });
});
