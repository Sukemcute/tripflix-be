import { ServiceUnavailableException } from '@nestjs/common';
import type { IndexHealth } from '../jobs/index-health.js';
import { AdminIndexHealthController } from './admin-index-health.controller.js';

describe('AdminIndexHealthController', () => {
  const sample = { checkedAt: 123, workers: [] };
  const health = { read: vi.fn(async () => sample) } as unknown as IndexHealth;

  it('trả IndexHealthDto khi healthCheck của exploreStore trả true hoặc không cấu hình', async () => {
    const plain = new AdminIndexHealthController(health);
    await expect(plain.check()).resolves.toEqual(sample);

    const healthy = new AdminIndexHealthController(health, { healthCheck: async () => true });
    await expect(healthy.check()).resolves.toEqual(sample);
  });

  it('ném 503 ServiceUnavailableException khi Typesense không phản hồi', async () => {
    const down = new AdminIndexHealthController(health, { healthCheck: async () => false });
    await expect(down.check()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
