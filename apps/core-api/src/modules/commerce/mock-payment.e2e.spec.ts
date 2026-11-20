import 'reflect-metadata';
import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ClsModule } from 'nestjs-cls';
import request from 'supertest';

describe('commerce E2E: cấu hình cổng thanh toán demo', () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    { nodeEnv: 'production', flag: 'true', enabled: false, vnpay: 'missing', vnpayEnabled: false },
    { nodeEnv: 'production', flag: 'true', enabled: false, vnpay: 'sandbox', vnpayEnabled: false },
    { nodeEnv: 'production', flag: 'true', enabled: false, vnpay: 'live', vnpayEnabled: true },
    { nodeEnv: 'development', flag: undefined, enabled: false, vnpay: 'missing', vnpayEnabled: true },
    { nodeEnv: 'development', flag: 'false', enabled: false, vnpay: 'missing', vnpayEnabled: true },
    { nodeEnv: 'development', flag: 'true', enabled: true, vnpay: 'missing', vnpayEnabled: true },
  ])('NODE_ENV=$nodeEnv, ENABLE_MOCK_PAYMENT=$flag, VNPay=$vnpay', async ({ nodeEnv, flag, enabled, vnpay, vnpayEnabled }) => {
    vi.stubEnv('NODE_ENV', nodeEnv);
    vi.stubEnv('ENABLE_MOCK_PAYMENT', flag);
    vi.stubEnv('VNPAY_TMN_CODE', 'TEST');
    vi.stubEnv('VNPAY_HASH_SECRET', 'test-only');
    const vnpayOrigin = vnpay === 'sandbox' ? 'https://sandbox.vnpayment.vn' : 'https://vnpay.example.test';
    vi.stubEnv('VNPAY_PAYMENT_URL', vnpay === 'missing' ? '' : `${vnpayOrigin}/payment`);
    vi.stubEnv('VNPAY_API_URL', vnpay === 'missing' ? '' : `${vnpayOrigin}/transactions`);
    vi.stubEnv('VNPAY_RETURN_URL', 'https://tripflix.example.test/return');
    vi.resetModules();
    const { AuthModule, MemorySidBlocklist } = await import('@tripflix/auth');
    const { MODULES, buildDrizzleToken, createDb, createPool, createTransactionalPlugins } = await import('@tripflix/db');
    const { CommerceModule } = await import('./commerce.module.js');
    const { CORE_ENV, DB_POOLS, REDIS } = await import('../../platform/tokens.js');
    const { PAYMENT_GATEWAY } = await import('./payment/application/gateway.port.js');
    const { VNPAY_CONFIG } = await import('./payment/application/vnpay.use-cases.js');
    const { MockGateway } = await import('./payment/infra/mock-gateway.js');
    const pool = createPool({ url: 'postgres://unused@127.0.0.1/unused', max: 1, applicationName: 'mock-payment-e2e' });
    const db = createDb(pool);
    const drizzleTokens = MODULES.map((name) => buildDrizzleToken(name));

    @Global()
    @Module({
      providers: [
        { provide: CORE_ENV, useValue: { NODE_ENV: nodeEnv, APP_ROLE: 'api' } },
        { provide: DB_POOLS, useValue: { commerce: pool } },
        { provide: REDIS, useValue: {} },
        ...drizzleTokens.map((token) => ({ provide: token, useValue: db })),
      ],
      exports: [CORE_ENV, DB_POOLS, REDIS, ...drizzleTokens],
    })
    class TestPlatformModule {}

    try {
      const moduleRef = await Test.createTestingModule({
        imports: [
          TestPlatformModule,
          ClsModule.forRoot({ global: true, plugins: createTransactionalPlugins([TestPlatformModule]) }),
          AuthModule.forRootAsync({
            useFactory: () => ({
              verifier: async () => ({ userId: 'member', role: 'member', sid: 'session', exp: 0 }),
              blocklist: new MemorySidBlocklist(),
            }),
          }),
          CommerceModule,
        ],
      }).compile();
      const app = moduleRef.createNestApplication();
      app.setGlobalPrefix('api');
      try {
        await app.init();
        const http = request(app.getHttpServer());
        await http.get('/api/mock-gateway/test-cards').expect(enabled ? 200 : 404);
        await http.get('/api/payments/vnpay/ipn').expect(200).expect({ RspCode: '97', Message: 'Invalid signature' });
        expect(Boolean(app.get(VNPAY_CONFIG))).toBe(vnpayEnabled);
        if (enabled) {
          expect(app.get(PAYMENT_GATEWAY)).toBeInstanceOf(MockGateway);
        } else {
          expect(app.get(PAYMENT_GATEWAY)).toBeNull();
          for (const action of ['pay', '3ds']) {
            const response = await http.post(`/api/checkout/00000000-0000-4000-8000-000000000001/${action}`)
              .set('Authorization', 'Bearer test').expect(404);
            expect(response.body.message).toBe('Thanh toán bằng token thẻ không khả dụng.');
          }
        }
      } finally {
        await app.close();
      }
    } finally {
      await pool.end();
    }
  }, 20_000);
});
