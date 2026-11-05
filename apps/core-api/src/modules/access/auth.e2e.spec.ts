import 'reflect-metadata';
import { Global, type INestApplication, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MemorySidBlocklist } from '@tripflix/auth';
import { createNoOpTransactionalPlugins } from '@tripflix/db';
import { createLocalJWKSet, decodeProtectedHeader, jwtVerify } from 'jose';
import { ClsModule } from 'nestjs-cls';
import request from 'supertest';
import type { CoreEnv } from '../../platform/env.js';
import { applyGlobalPrefix } from '../../platform/http.js';
import { CORE_ENV, DB_POOLS, REDIS } from '../../platform/tokens.js';
import { AccessModule } from './access.module.js';
import {
  ACCESS_SID_BLOCKLIST,
  ACCESS_STORE,
  CLOCK,
  LOGIN_RATE_LIMITER,
} from './auth/application/ports.js';
import { hashRefreshToken } from './auth/application/refresh-token.js';
import { INVALID_CREDENTIALS_MESSAGE } from './auth/domain/credentials.js';
import { MemoryAccessStore } from './auth/infra/memory/memory-access.store.js';
import { MemoryLoginRateLimiter } from './auth/infra/memory/memory-login-rate-limiter.js';

// E2E chạy app Nest thật (controller, guard, argon2, jose), chỉ thay database và Redis bằng bản bộ nhớ.
const env = {
  NODE_ENV: 'test',
  AUTH_JWT_ISSUER: 'tripflix-core',
  AUTH_JWT_AUDIENCE: 'tripflix',
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

describe('access E2E', () => {
  let app: INestApplication;
  let store: MemoryAccessStore;
  let nowMs = Date.now();
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    store = new MemoryAccessStore();
    const moduleRef = await Test.createTestingModule({
      imports: [
        FakePlatformModule,
        // @Transactional('access') chạy được nhưng không mở transaction database (store bộ nhớ).
        ClsModule.forRoot({ global: true, plugins: createNoOpTransactionalPlugins() }),
        AccessModule,
      ],
    })
      .overrideProvider(ACCESS_STORE)
      .useValue(store)
      .overrideProvider(LOGIN_RATE_LIMITER)
      .useValue(new MemoryLoginRateLimiter(() => nowMs))
      .overrideProvider(ACCESS_SID_BLOCKLIST)
      .useValue(new MemorySidBlocklist(() => nowMs))
      .overrideProvider(CLOCK)
      .useValue(() => new Date(nowMs))
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    applyGlobalPrefix(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  async function registerAndLogin(email: string, role?: 'moderator' | 'superadmin') {
    await http().post('/api/auth/register').send({ email, password: PASSWORD, displayName: email }).expect(201);
    if (role) {
      const user = [...store.userRows.values()].find((u) => u.email === email)!;
      store.userRows.set(user.id, { ...user, role });
    }
    const res = await http().post('/api/auth/login').send({ email, password: PASSWORD }).expect(200);
    return res.body as { accessToken: string; refreshToken: string };
  }

  it('đăng ký → đăng nhập → /auth/me → làm mới → đăng xuất → token cũ bị từ chối', async () => {
    const reg = await http()
      .post('/api/auth/register')
      .send({ email: 'Khang@Example.com', password: PASSWORD, displayName: 'Khang', role: 'superadmin' })
      .expect(201);
    expect(reg.body).toMatchObject({ email: 'khang@example.com', role: 'member' });
    expect(reg.body).not.toHaveProperty('passwordHash');
    expect(store.userRows.get(reg.body.id)!.passwordHash).toMatch(/^\$argon2id\$/);
    // Đăng ký ghi đúng một sự kiện vào outbox, payload không có email.
    const events = store.outboxRows.filter((e) => e.userId === reg.body.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'access.user.registered',
      version: 1,
      producer: 'core-api/access',
      payload: { userId: reg.body.id, displayName: 'Khang' },
    });
    expect(JSON.stringify(events[0]!.payload)).not.toContain('@');

    const login = await http().post('/api/auth/login').send({ email: 'khang@example.com', password: PASSWORD }).expect(200);
    expect(login.body).toMatchObject({ tokenType: 'Bearer', expiresIn: 900 });
    const { accessToken, refreshToken } = login.body as { accessToken: string; refreshToken: string };

    const me = await http().get('/api/auth/me').set('Authorization', `Bearer ${accessToken}`).expect(200);
    expect(me.body).toMatchObject({ id: reg.body.id, email: 'khang@example.com', role: 'member' });

    const refreshed = await http().post('/api/auth/refresh').send({ refreshToken }).expect(200);
    expect(refreshed.body.refreshToken).not.toBe(refreshToken);
    const sessionRow = [...store.sessionRows.values()].find((s) => s.userId === reg.body.id)!;
    expect(sessionRow.refreshTokenHash).toBe(hashRefreshToken(refreshed.body.refreshToken));

    await http().post('/api/auth/logout').set('Authorization', `Bearer ${refreshed.body.accessToken}`).expect(204);
    expect(store.sessionRows.has(sessionRow.id)).toBe(false);

    // Cả hai access token của phiên (cũ và mới) bị từ chối ngay, chưa cần chờ 15 phút.
    await http().get('/api/auth/me').set('Authorization', `Bearer ${refreshed.body.accessToken}`).expect(401);
    await http().get('/api/auth/me').set('Authorization', `Bearer ${accessToken}`).expect(401);
    await http().post('/api/auth/refresh').send({ refreshToken: refreshed.body.refreshToken }).expect(401);
  });

  it('access token ES256 có đủ claim và kiểm được bằng /.well-known/jwks.json', async () => {
    const { accessToken } = await registerAndLogin('claims@example.com');
    const jwks = await http().get('/.well-known/jwks.json').expect(200);
    expect(jwks.body.keys[0]).toMatchObject({ kty: 'EC', crv: 'P-256', alg: 'ES256' });
    expect(jwks.body.keys[0]).not.toHaveProperty('d');

    const { payload } = await jwtVerify(accessToken, createLocalJWKSet(jwks.body), {
      issuer: 'tripflix-core',
      audience: 'tripflix',
    });
    expect(decodeProtectedHeader(accessToken)).toMatchObject({ alg: 'ES256', kid: jwks.body.keys[0].kid });
    expect(Object.keys(payload).sort()).toEqual(['aud', 'exp', 'iat', 'iss', 'role', 'sid', 'sub']);
    expect(payload.exp! - payload.iat!).toBe(900);
  });

  it('dùng lại refresh token cũ sau 10 giây thì thu hồi cả phiên', async () => {
    const { accessToken, refreshToken } = await registerAndLogin('reuse@example.com');
    await http().post('/api/auth/refresh').send({ refreshToken }).expect(200);
    nowMs += 11_000;
    const reused = await http().post('/api/auth/refresh').send({ refreshToken }).expect(401);
    expect(reused.body.message).toMatch(/thu hồi/);
    await http().get('/api/auth/me').set('Authorization', `Bearer ${accessToken}`).expect(401);
  });

  it('sai email hay sai mật khẩu đều cùng một thông báo; sai quá 5 lần thì 429', async () => {
    await registerAndLogin('limit@example.com');
    const wrongEmail = await http().post('/api/auth/login').send({ email: 'nobody@example.com', password: PASSWORD }).expect(401);
    const wrongPassword = await http().post('/api/auth/login').send({ email: 'limit@example.com', password: 'sai-mat-khau' }).expect(401);
    expect(wrongEmail.body.message).toBe(INVALID_CREDENTIALS_MESSAGE);
    expect(wrongPassword.body).toEqual(wrongEmail.body);

    for (let i = 0; i < 4; i += 1) {
      await http().post('/api/auth/login').send({ email: 'limit@example.com', password: 'sai-mat-khau' }).expect(401);
    }
    // Đã sai 5 lần: lần thứ 6 bị chặn, kể cả khi nhập đúng mật khẩu.
    const blocked = await http().post('/api/auth/login').send({ email: 'limit@example.com', password: PASSWORD }).expect(429);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);

    nowMs += 15 * 60 * 1000 + 1_000;
    await http().post('/api/auth/login').send({ email: 'limit@example.com', password: PASSWORD }).expect(200);
  });

  it('phân quyền /admin/*: member 403, moderator chỉ /admin/me, superadmin cả hai', async () => {
    const member = await registerAndLogin('member@example.com');
    const moderator = await registerAndLogin('moderator@example.com', 'moderator');
    const superadmin = await registerAndLogin('superadmin@example.com', 'superadmin');
    const get = (path: string, token?: string) => {
      const req = http().get(path);
      return token ? req.set('Authorization', `Bearer ${token}`) : req;
    };

    await get('/api/admin/me').expect(401);
    await get('/api/admin/me', member.accessToken).expect(403);
    await get('/api/admin/staff', member.accessToken).expect(403);

    await get('/api/admin/me', moderator.accessToken).expect(200);
    await get('/api/admin/staff', moderator.accessToken).expect(403);

    await get('/api/admin/me', superadmin.accessToken).expect(200);
    const staff = await get('/api/admin/staff', superadmin.accessToken).expect(200);
    expect(staff.body.map((u: { email: string }) => u.email).sort()).toEqual([
      'moderator@example.com',
      'superadmin@example.com',
    ]);
  });

  it('kiểm dữ liệu đăng ký và chặn email trùng', async () => {
    await http().post('/api/auth/register').send({ email: 'khong-phai-email', password: PASSWORD, displayName: 'A' }).expect(400);
    await http().post('/api/auth/register').send({ email: 'ngan@example.com', password: '123', displayName: 'A' }).expect(400);
    await http().post('/api/auth/register').send({ email: 'dup@example.com', password: PASSWORD, displayName: 'A' }).expect(201);
    await http().post('/api/auth/register').send({ email: 'DUP@example.com', password: PASSWORD, displayName: 'B' }).expect(409);
  });
});
