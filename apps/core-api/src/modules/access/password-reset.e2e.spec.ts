import { registerTestAccount } from '../../platform/registration.fixture.js';
import 'reflect-metadata';
import { Global, type INestApplication, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MemorySidBlocklist } from '@tripflix/auth';
import { AccessPasswordResetRequestedV1Schema } from '@tripflix/contracts';
import { createNoOpTransactionalPlugins } from '@tripflix/db';
import { ClsModule } from 'nestjs-cls';
import request from 'supertest';
import type { CoreEnv } from '../../platform/env.js';
import { applyGlobalPrefix } from '../../platform/http.js';
import { CORE_ENV, DB_POOLS, REDIS } from '../../platform/tokens.js';
import { AccessModule } from './access.module.js';
import { FORGOT_ACCEPTED_MESSAGE, INVALID_RESET_TOKEN_MESSAGE } from './account/domain/password-reset.js';
import { ACCESS_SID_BLOCKLIST, ACCESS_STORE, ACTION_RATE_LIMITER, LOGIN_RATE_LIMITER, PASSWORD_HASHER } from './auth/application/ports.js';
import { createTestPasswordHasher } from './auth/infra/test-password-hasher.js';
import { MemoryAccessStore } from './auth/infra/memory/memory-access.store.js';
import { MemoryActionRateLimiter } from './auth/infra/memory/memory-action-rate-limiter.js';
import { MemoryLoginRateLimiter } from './auth/infra/memory/memory-login-rate-limiter.js';

const RESET_PAGE = 'https://tripflix.example/dat-lai-mat-khau';
const env = {
  NODE_ENV: 'test',
  AUTH_JWT_ISSUER: 'tripflix-core',
  AUTH_JWT_AUDIENCE: 'tripflix',
  AUTH_PASSWORD_RESET_URL: RESET_PAGE,
} as CoreEnv;

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

const PASSWORD = 'mat-khau-an-toan';
const NEW_PASSWORD = 'mat-khau-moi-123';

describe('TF057: quên và đặt lại mật khẩu', () => {
  let app: INestApplication;
  let store: MemoryAccessStore;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    store = new MemoryAccessStore();
    const moduleRef = await Test.createTestingModule({
      imports: [
        FakePlatformModule,
        ClsModule.forRoot({ global: true, plugins: createNoOpTransactionalPlugins() }),
        AccessModule,
      ],
    })
      .overrideProvider(ACCESS_STORE)
      .useValue(store)
      .overrideProvider(PASSWORD_HASHER)
      .useValue(createTestPasswordHasher())
      .overrideProvider(LOGIN_RATE_LIMITER)
      .useValue(new MemoryLoginRateLimiter())
      .overrideProvider(ACTION_RATE_LIMITER)
      .useValue(new MemoryActionRateLimiter())
      .overrideProvider(ACCESS_SID_BLOCKLIST)
      .useValue(new MemorySidBlocklist())
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    applyGlobalPrefix(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  async function register(email: string) {
    const res = await registerTestAccount(app, { email, password: PASSWORD, displayName: 'Khang' });
    return res.body.id as string;
  }

  const login = (email: string, password = PASSWORD) => http().post('/api/auth/login').send({ email, password });
  const forgot = (email: string, ip?: string) => {
    const req = http().post('/api/auth/password/forgot');
    if (ip) req.set('X-Forwarded-For', ip);
    return req.send({ email });
  };
  const resetEvents = (userId: string) =>
    store.outboxRows.filter((e) => e.type === 'access.password_reset_requested' && e.userId === userId);
  const tokenOf = (resetUrl: string) => new URL(resetUrl).searchParams.get('token')!;

  it('email có tài khoản: 202, phát access.password_reset_requested đúng hợp đồng, link trỏ về trang web', async () => {
    const userId = await register('Forgot@Example.com');
    const res = await forgot('  FORGOT@example.com ').expect(202);
    expect(res.body).toEqual({ message: FORGOT_ACCEPTED_MESSAGE });

    const [event] = resetEvents(userId);
    const payload = AccessPasswordResetRequestedV1Schema.parse(event?.payload);
    expect(payload).toMatchObject({ userId, email: 'forgot@example.com', displayName: 'Khang' });
    expect(payload.resetUrl.startsWith(`${RESET_PAGE}?token=`)).toBe(true);
    const minutes = (new Date(payload.expiresAt).getTime() - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(29);
    expect(minutes).toBeLessThanOrEqual(30);
    // Database chỉ giữ bản băm, không giữ token trên link.
    expect(store.passwordResetRows.some((r) => r.tokenHash === tokenOf(payload.resetUrl))).toBe(false);
  });

  it('email không có tài khoản hoặc tài khoản bị khoá: cùng 202, cùng câu, không có sự kiện', async () => {
    const countResetEvents = () => store.outboxRows.filter((e) => e.type === 'access.password_reset_requested').length;
    const before = countResetEvents();
    const unknown = await forgot('khong-ton-tai@example.com').expect(202);
    expect(unknown.body).toEqual({ message: FORGOT_ACCEPTED_MESSAGE });

    const lockedId = await register('locked-forgot@example.com');
    store.userRows.set(lockedId, { ...store.userRows.get(lockedId)!, status: 'locked' });
    expect((await forgot('locked-forgot@example.com').expect(202)).body).toEqual(unknown.body);
    expect(countResetEvents()).toBe(before);
  });

  it('đặt lại: 204, mọi phiên bị thu hồi, đăng nhập bằng mật khẩu mới; link dùng lại thì 400', async () => {
    const email = 'reset@example.com';
    const userId = await register(email);
    const phone = (await login(email).expect(200)).body;
    await forgot(email).expect(202);
    const token = tokenOf(resetEvents(userId)[0]!.payload.resetUrl as string);

    await http().post('/api/auth/password/reset').send({ token, newPassword: NEW_PASSWORD }).expect(204);
    await http().get('/api/auth/me').set('Authorization', `Bearer ${phone.accessToken}`).expect(401);
    await http().post('/api/auth/refresh').send({ refreshToken: phone.refreshToken }).expect(401);
    await login(email).expect(401);
    await login(email, NEW_PASSWORD).expect(200);

    const again = await http().post('/api/auth/password/reset').send({ token, newPassword: 'mat-khau-thu-ba' }).expect(400);
    expect(again.body.message).toBe(INVALID_RESET_TOKEN_MESSAGE);
    expect(store.auditRows.filter((a) => a.actorUserId === userId).map((a) => a.action)).toEqual(
      expect.arrayContaining(['auth.password_reset_requested', 'auth.password_reset']),
    );
  });

  it('yêu cầu mới làm link cũ hết dùng được; token rác, hết hạn: 400 cùng câu; mật khẩu ngắn: 400', async () => {
    const email = 'twice@example.com';
    const userId = await register(email);
    await forgot(email).expect(202);
    await forgot(email).expect(202);
    const [first, second] = resetEvents(userId).map((e) => tokenOf(e.payload.resetUrl as string));

    const old = await http().post('/api/auth/password/reset').send({ token: first, newPassword: NEW_PASSWORD }).expect(400);
    expect(old.body.message).toBe(INVALID_RESET_TOKEN_MESSAGE);
    await http().post('/api/auth/password/reset').send({ token: 'khong-hop-le', newPassword: NEW_PASSWORD }).expect(400);
    await http().post('/api/auth/password/reset').send({ token: second, newPassword: 'ngan' }).expect(400);

    // Cho token còn lại hết hạn.
    for (const row of store.passwordResetRows.filter((r) => r.userId === userId)) row.expiresAt = new Date(Date.now() - 1000);
    const expired = await http().post('/api/auth/password/reset').send({ token: second, newPassword: NEW_PASSWORD }).expect(400);
    expect(expired.body.message).toBe(INVALID_RESET_TOKEN_MESSAGE);
    await login(email).expect(200);
  });

  it('bị khoá sau khi xin link: đặt lại bị từ chối, mật khẩu không đổi', async () => {
    const email = 'locked-later@example.com';
    const userId = await register(email);
    await forgot(email).expect(202);
    const token = tokenOf(resetEvents(userId)[0]!.payload.resetUrl as string);
    store.userRows.set(userId, { ...store.userRows.get(userId)!, status: 'locked' });

    await http().post('/api/auth/password/reset').send({ token, newPassword: NEW_PASSWORD }).expect(400);
    expect(store.userRows.get(userId)!.passwordHash).not.toBe(NEW_PASSWORD);
    store.userRows.set(userId, { ...store.userRows.get(userId)!, status: 'active' });
    await login(email).expect(200);
  });

  it('giới hạn: lần thứ 4 trong 1 giờ cho cùng email nhận 429, kể cả email không có tài khoản', async () => {
    for (let i = 0; i < 3; i += 1) await forgot('spam@example.com', '10.0.0.9').expect(202);
    const blocked = await forgot('spam@example.com', '10.0.0.9').expect(429);
    expect(blocked.headers['retry-after']).toBeDefined();
    // Email khác vẫn được.
    await forgot('other-spam@example.com', '10.0.0.9').expect(202);
  });
});
