import { ServiceUnavailableException } from '@nestjs/common';
import type { DbPools } from './tokens.js';
import type { CoreEnv } from './env.js';
import { HealthController } from './health.controller.js';

const env = { APP_ROLE: 'all' } as CoreEnv;
const pool = (up: boolean) => ({ query: up ? async () => ({}) : async () => Promise.reject(new Error('down')) });
const pools = (up: boolean) =>
  Object.fromEntries(
    ['access', 'content', 'discovery', 'analytics', 'commerce'].map((m) => [m, pool(up)]),
  ) as unknown as DbPools;

describe('HealthController', () => {
  it('trả ok khi mọi kết nối đều sống', async () => {
    const ctrl = new HealthController(env, pools(true), { ping: async () => 'PONG' });
    await expect(ctrl.check()).resolves.toMatchObject({ status: 'ok', checks: { redis: true } });
  });

  it('trả 503 khi một module không kết nối được database', async () => {
    const broken = { ...pools(true), commerce: pool(false) } as unknown as DbPools;
    const ctrl = new HealthController(env, broken, { ping: async () => 'PONG' });
    await expect(ctrl.check()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
