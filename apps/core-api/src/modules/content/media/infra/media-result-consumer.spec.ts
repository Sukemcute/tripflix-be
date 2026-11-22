import type { Redis } from 'ioredis';
import type { CoreEnv } from '../../../../platform/env.js';
import type { MediaResultUseCases } from '../application/media-result.use-cases.js';
import { MediaResultConsumer } from './media-result-consumer.js';

describe('MediaResultConsumer', () => {
  it('không chạy khi APP_ROLE là api', async () => {
    const duplicate = vi.fn();
    const consumer = new MediaResultConsumer(
      { APP_ROLE: 'api' } as CoreEnv,
      { duplicate } as unknown as Redis,
      {} as MediaResultUseCases,
    );

    consumer.onApplicationBootstrap();
    await consumer.onApplicationShutdown();

    expect(duplicate).not.toHaveBeenCalled();
  });
});
