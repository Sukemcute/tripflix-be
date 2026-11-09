import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Global, Module, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MemorySidBlocklist } from '@tripflix/auth';
import { createNoOpTransactionalPlugins } from '@tripflix/db';
import { IdempotencyModule, MemoryIdempotencyStore } from '@tripflix/idempotency';
import { ClsModule } from 'nestjs-cls';
import request from 'supertest';
import { vi } from 'vitest';
import { applyGlobalPrefix } from '../../../../platform/http.js';
import { CORE_ENV, DB_POOLS, REDIS } from '../../../../platform/tokens.js';
import { registerTestAccount } from '../../../../platform/registration.fixture.js';
import {
  ACCESS_SID_BLOCKLIST,
  ACCESS_STORE,
  ACTION_RATE_LIMITER,
  AccessModule,
  LOGIN_RATE_LIMITER,
  MemoryAccessStore,
  MemoryActionRateLimiter,
  MemoryLoginRateLimiter,
} from '../../../access/index.js';
import { DecideCaseUseCase, SubmitReportUseCase } from '../application/moderation.use-cases.js';
import { ChangeVisibilityUseCase } from '../application/change-visibility.use-case.js';
import { ModerationRepository } from '../infra/moderation.repository.js';
import { AdminModerationController, ReportsController } from './moderation.controller.js';
import { MediaFacade } from '../../media/media.facade.js';

@Global()
@Module({
  providers: [
    {
      provide: CORE_ENV,
      useValue: { NODE_ENV: 'test', AUTH_JWT_ISSUER: 'tripflix-core', AUTH_JWT_AUDIENCE: 'tripflix' },
    },
    { provide: DB_POOLS, useValue: {} },
    { provide: REDIS, useValue: {} },
  ],
  exports: [CORE_ENV, DB_POOLS, REDIS],
})
class TestPlatformModule {}

describe('TF32 HTTP roles, validation và Idempotency-Key', () => {
  let app: INestApplication;
  const store = new MemoryAccessStore();
  const submit = vi.fn().mockImplementation(async (input) => ({ id: randomUUID(), ...input }));
  const decide = vi
    .fn()
    .mockResolvedValue({
      actionId: randomUUID(),
      changedCount: 1,
      previousStatus: 'visible',
      status: 'hidden',
    });
  const tokens: Record<string, string> = {};
  beforeAll(async () => {
    const ref = await Test.createTestingModule({
      imports: [
        TestPlatformModule,
        AccessModule,
        ClsModule.forRoot({ global: true, plugins: createNoOpTransactionalPlugins() }),
        IdempotencyModule.forFeature({ useFactory: () => new MemoryIdempotencyStore() }),
      ],
      controllers: [AdminModerationController, ReportsController],
      providers: [
        { provide: MediaFacade, useValue: { getPlayback: async () => ({}) } },
        { provide: SubmitReportUseCase, useValue: { execute: submit } },
        { provide: DecideCaseUseCase, useValue: { execute: decide } },
        { provide: ChangeVisibilityUseCase, useValue: { execute: decide } },
        {
          provide: ModerationRepository,
          useValue: { queue: async () => ({ items: [], total: 0 }), log: async () => [] },
        },
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
    app = ref.createNestApplication({ logger: false });
    applyGlobalPrefix(app);
    await app.init();
    for (const role of ['member', 'moderator', 'superadmin'] as const) {
      const email = `${role}@tf32.test`;
      const password = 'test-password-123';
      const account = await registerTestAccount(app, { email, password, displayName: role });
      store.userRows.set(account.body.id, { ...store.userRows.get(account.body.id)!, role });
      const login = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email, password })
        .expect(200);
      tokens[role] = login.body.accessToken;
    }
  });
  afterAll(async () => {
    await app?.close();
  });
  const http = () => request(app.getHttpServer());
  it('guest 401, member 403; moderator/superadmin đọc queue được', async () => {
    await http().get('/api/v1/admin/moderation/queue').expect(401);
    await http().get('/api/v1/admin/moderation/queue').auth(tokens.member!, { type: 'bearer' }).expect(403);
    for (const role of ['moderator', 'superadmin'])
      await http().get('/api/v1/admin/moderation/queue').auth(tokens[role]!, { type: 'bearer' }).expect(200);
  });
  it('quyết định bắt buộc reasonCode và Idempotency-Key, replay chỉ gọi use case một lần', async () => {
    const url = `/api/v1/admin/moderation/queue/${randomUUID()}/decisions`;
    const body = { action: 'hide', reasonCode: 'HARASSMENT' };
    await http().post(url).auth(tokens.moderator!, { type: 'bearer' }).send(body).expect(400);
    await http()
      .post(url)
      .auth(tokens.moderator!, { type: 'bearer' })
      .set('Idempotency-Key', randomUUID())
      .send({ action: 'hide' })
      .expect(400);
    const key = randomUUID();
    const before = decide.mock.calls.length;
    const first = await http()
      .post(url)
      .auth(tokens.moderator!, { type: 'bearer' })
      .set('Idempotency-Key', key)
      .send(body)
      .expect(201);
    const replay = await http()
      .post(url)
      .auth(tokens.moderator!, { type: 'bearer' })
      .set('Idempotency-Key', key)
      .send(body)
      .expect(201);
    expect(replay.body).toEqual(first.body);
    expect(decide.mock.calls.length - before).toBe(1);
  });
  it('user báo cáo được, validate UUID/reason/detail, guest bị chặn', async () => {
    const url = `/api/v1/posts/${randomUUID()}/reports`;
    await http().post(url).send({ reasonCode: 'SCAM' }).expect(401);
    await http()
      .post(url)
      .auth(tokens.member!, { type: 'bearer' })
      .set('Idempotency-Key', randomUUID())
      .send({ reasonCode: 'SCAM' })
      .expect(201);
    await http()
      .post(url)
      .auth(tokens.member!, { type: 'bearer' })
      .set('Idempotency-Key', randomUUID())
      .send({ reasonCode: 'SCAM', reasonDetail: 'x'.repeat(501) })
      .expect(400);
    await http()
      .get('/api/v1/admin/moderation/queue?limit=-1')
      .auth(tokens.moderator!, { type: 'bearer' })
      .expect(400);
  });
});
