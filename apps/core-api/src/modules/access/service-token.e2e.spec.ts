import { ACTION_RATE_LIMITER, MemoryActionRateLimiter } from './index.js';
import { registerTestAccount } from '../../platform/registration.fixture.js';
import 'reflect-metadata';
import { Controller, Get, Global, type INestApplication, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CurrentService, MemorySidBlocklist, ServiceOnly, type ServiceCaller } from '@tripflix/auth';
import { createNoOpTransactionalPlugins } from '@tripflix/db';
import { decodeJwt } from 'jose';
import { ClsModule } from 'nestjs-cls';
import request from 'supertest';
import type { CoreEnv } from '../../platform/env.js';
import { applyGlobalPrefix } from '../../platform/http.js';
import { CORE_ENV, DB_POOLS, REDIS } from '../../platform/tokens.js';
import { AccessModule } from './access.module.js';
import {
  ACCESS_SID_BLOCKLIST,
  ACCESS_STORE,
  LOGIN_RATE_LIMITER,
  PASSWORD_HASHER,
  type PasswordHasher,
} from './auth/application/ports.js';
import { MemoryAccessStore } from './auth/infra/memory/memory-access.store.js';
import { MemoryLoginRateLimiter } from './auth/infra/memory/memory-login-rate-limiter.js';
import { disableServiceClient, registerServiceClient } from './service/application/service-token.use-cases.js';
import { INVALID_SERVICE_CREDENTIALS_MESSAGE } from './service/domain/service-client-rules.js';

const env = { NODE_ENV: 'test', AUTH_JWT_ISSUER: 'tripflix-core', AUTH_JWT_AUDIENCE: 'tripflix' } as CoreEnv;

@Global()
@Module({
  providers: [
    { provide: CORE_ENV, useValue: env },
    { provide: DB_POOLS, useValue: {} },
    { provide: REDIS, useValue: {} },
  ],
  exports: [CORE_ENV, DB_POOLS, REDIS],
})
class FakePlatformModule {}

/** API nội bộ giả của core-api: một cái chỉ cho ai-service, một cái cho mọi service. */
@Controller('internal')
class InternalTestController {
  @Get('ai-only')
  @ServiceOnly('ai-service')
  aiOnly(@CurrentService() caller: ServiceCaller) {
    return caller;
  }

  @Get('any-service')
  @ServiceOnly()
  anyService(@CurrentService() caller: ServiceCaller) {
    return caller;
  }
}

@Module({ controllers: [InternalTestController] })
class InternalTestModule {}

describe('TF058: token giữa các service', () => {
  let app: INestApplication;
  let store: MemoryAccessStore;
  let hasher: PasswordHasher;
  const http = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
  const secrets: Record<string, string> = {};

  const issue = (clientId: string, audience = 'core-api', clientSecret = secrets[clientId] ?? 'khong-co') =>
    http().post('/api/auth/service-token').send({ clientId, clientSecret, audience });

  beforeAll(async () => {
    store = new MemoryAccessStore();
    const moduleRef = await Test.createTestingModule({
      imports: [
        FakePlatformModule,
        ClsModule.forRoot({ global: true, plugins: createNoOpTransactionalPlugins() }),
        AccessModule,
        InternalTestModule,
      ],
    })
      .overrideProvider(ACCESS_STORE)
      .useValue(store)
      .overrideProvider(ACTION_RATE_LIMITER)
      .useValue(new MemoryActionRateLimiter())
      .overrideProvider(LOGIN_RATE_LIMITER)
      .useValue(new MemoryLoginRateLimiter())
      .overrideProvider(ACCESS_SID_BLOCKLIST)
      .useValue(new MemorySidBlocklist())
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    applyGlobalPrefix(app);
    await app.init();

    hasher = moduleRef.get(PASSWORD_HASHER);
    for (const [clientId, audiences] of [
      ['ai-service', ['core-api', 'notification-service']],
      ['video-worker', ['core-api']],
      ['retired-service', ['core-api']],
      ['bruteforce-target', ['core-api']],
    ] as const) {
      secrets[clientId] = (await registerServiceClient({ store, hasher, userAudience: 'tripflix' }, { clientId, audiences: [...audiences] })).clientSecret;
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it('cấp token: typ=service, sub=clientId, aud=service nhận, sống 5 phút, không có role, sid', async () => {
    const res = await issue('ai-service').expect(200);
    expect(res.body).toMatchObject({ tokenType: 'Bearer', expiresIn: 300 });
    const claims = decodeJwt(res.body.accessToken);
    expect(claims).toMatchObject({ typ: 'service', sub: 'ai-service', aud: 'core-api', iss: 'tripflix-core' });
    expect(claims.exp! - claims.iat!).toBe(300);
    expect(claims).not.toHaveProperty('role');
    expect(claims).not.toHaveProperty('sid');
    // Database chỉ giữ bản băm argon2, không giữ secret gốc.
    expect(store.serviceClientRows.get('ai-service')?.secretHash).toMatch(/^\$argon2id\$/);
  });

  it('gọi API @ServiceOnly: đúng client 200; client khác 403; @ServiceOnly() không giới hạn thì 200', async () => {
    const ai = (await issue('ai-service').expect(200)).body.accessToken;
    const video = (await issue('video-worker').expect(200)).body.accessToken;

    expect((await http().get('/api/internal/ai-only').set(bearer(ai)).expect(200)).body).toMatchObject({
      clientId: 'ai-service',
      audience: 'core-api',
    });
    await http().get('/api/internal/ai-only').set(bearer(video)).expect(403);
    await http().get('/api/internal/any-service').set(bearer(video)).expect(200);
    await http().get('/api/internal/any-service').expect(401);
  });

  it('token người dùng bị từ chối ở API service; token service bị từ chối ở API người dùng', async () => {
    await registerTestAccount(app, { email: 'user@example.com', password: 'mat-khau-an-toan', displayName: 'U' });
    const user = (await http().post('/api/auth/login').send({ email: 'user@example.com', password: 'mat-khau-an-toan' }).expect(200)).body;
    await http().get('/api/internal/any-service').set(bearer(user.accessToken)).expect(401);

    const ai = (await issue('ai-service').expect(200)).body.accessToken;
    await http().get('/api/auth/me').set(bearer(ai)).expect(401);
  });

  it('token cho service khác (aud=notification-service) không dùng được ở core-api', async () => {
    const forNotification = (await issue('ai-service', 'notification-service').expect(200)).body.accessToken;
    expect(decodeJwt(forNotification).aud).toBe('notification-service');
    await http().get('/api/internal/any-service').set(bearer(forNotification)).expect(401);
  });

  it('sai secret, client không có, aud không được phép: cùng 401 và cùng thông báo; lý do ghi audit', async () => {
    const responses = [
      await issue('ai-service', 'core-api', 'sai-secret').expect(401),
      await issue('khong-ton-tai', 'core-api', 'bat-ky').expect(401),
      await issue('video-worker', 'notification-service').expect(401),
    ];
    for (const res of responses) expect(res.body.message).toBe(INVALID_SERVICE_CREDENTIALS_MESSAGE);
    const reasons = store.auditRows.filter((a) => a.action === 'service.token_failed').map((a) => a.meta?.reason);
    expect(reasons).toEqual(expect.arrayContaining(['wrong_secret', 'unknown_client', 'audience_not_allowed']));
  });

  it('client bị vô hiệu hoá: 401 khi xin token mới', async () => {
    await issue('retired-service').expect(200);
    await disableServiceClient({ store, now: () => new Date() }, 'retired-service');
    const res = await issue('retired-service').expect(401);
    expect(res.body.message).toBe(INVALID_SERVICE_CREDENTIALS_MESSAGE);
    expect(store.auditRows.some((a) => a.action === 'service.token_failed' && a.meta?.reason === 'disabled')).toBe(true);
  });

  it('sai 5 lần theo client thì lần thứ 6 nhận 429, kể cả đúng secret', async () => {
    for (let i = 0; i < 5; i += 1) await issue('bruteforce-target', 'core-api', `sai-${i}`).expect(401);
    const blocked = await issue('bruteforce-target').expect(429);
    expect(blocked.headers['retry-after']).toBeDefined();
  });

  it('tạo client: từ chối aud trùng aud người dùng và clientId đã có', async () => {
    await expect(registerServiceClient({ store, hasher, userAudience: 'tripflix' }, { clientId: 'sneaky', audiences: ['tripflix'] })).rejects.toThrow(
      /trùng aud/,
    );
    await expect(registerServiceClient({ store, hasher, userAudience: 'tripflix' }, { clientId: 'ai-service', audiences: ['core-api'] })).rejects.toThrow(
      /đã có/,
    );
  });
});
