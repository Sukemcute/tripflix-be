import type { Redis } from 'ioredis';
import type { CoreEnv } from '../../../../platform/env.js';
import type { TrendSignalsUseCases } from '../application/trend-signals.use-cases.js';
import { TrendSignalsConsumer } from './trend-signals.consumer.js';

describe('TrendSignalsConsumer', () => {
  it('không chạy khi APP_ROLE là api', async () => {
    const duplicate = vi.fn();
    const consumer = new TrendSignalsConsumer(
      { APP_ROLE: 'api' } as CoreEnv,
      { duplicate } as unknown as Redis,
      {} as TrendSignalsUseCases,
    );

    consumer.onApplicationBootstrap();
    await consumer.onApplicationShutdown();

    expect(duplicate).not.toHaveBeenCalled();
  });
});
