import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { ScreeningConsumer } from './screening.consumer.js';

describe('Screening recovery', () => {
  it('phục hồi từng scan độc lập và giữ occurredAt để tôn trọng quyết định staff', async () => {
    const occurredAt = new Date('2026-11-13T00:00:00Z');
    const claim = {
      execute: vi.fn().mockResolvedValue([
        { eventId: 'first', targetType: 'post', targetId: 'p', occurredAt, attempts: 6 },
        { eventId: 'second', targetType: 'comment', targetId: 'c', occurredAt, attempts: 6 },
      ]),
    };
    const screen = {
      execute: vi.fn().mockRejectedValueOnce(new Error('AI unavailable')).mockResolvedValueOnce(undefined),
    };
    const consumer = new ScreeningConsumer(
      { APP_ROLE: 'api' } as never,
      {} as never,
      screen as never,
      claim as never,
    );
    await consumer.recover();
    expect(screen.execute).toHaveBeenNthCalledWith(1, 'first', 'post', 'p', occurredAt.toISOString());
    expect(screen.execute).toHaveBeenNthCalledWith(2, 'second', 'comment', 'c', occurredAt.toISOString());
  });
});
