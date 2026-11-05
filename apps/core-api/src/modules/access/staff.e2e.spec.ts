import 'reflect-metadata';
import { Global, type INestApplication, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MemorySidBlocklist } from '@tripflix/auth';
import { createNoOpTransactionalPlugins } from '@tripflix/db';
import { decodeJwt } from 'jose';
import { ClsModule } from 'nestjs-cls';
import request from 'supertest';
import type { CoreEnv } from '../../platform/env.js';
import { applyGlobalPrefix } from '../../platform/http.js';
import { CORE_ENV, DB_POOLS, REDIS } from '../../platform/tokens.js';
import { AccessModule } from './access.module.js';
import { ACCESS_SID_BLOCKLIST, ACCESS_STORE, LOGIN_RATE_LIMITER } from './auth/application/ports.js';
import { INVALID_CREDENTIALS_MESSAGE } from './auth/domain/credentials.js';
import { MemoryAccessStore } from './auth/infra/memory/memory-access.store.js';
import { MemoryLoginRateLimiter } from './auth/infra/memory/memory-login-rate-limiter.js';

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

const PASSWORD = 'mat-khau-an-toan';

describe('TF054: quản lý nhân viên và khoá tài khoản', () => {
  let app: INestApplication;
  let store: MemoryAccessStore;
  const http = () => request(app.getHttpServer());
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });

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
      .overrideProvider(LOGIN_RATE_LIMITER)
      .useValue(new MemoryLoginRateLimiter())
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

  async function createAccount(email: string, role?: 'moderator' | 'superadmin') {
    const reg = await http().post('/api/auth/register').send({ email, password: PASSWORD, displayName: email }).expect(201);
    if (role) store.userRows.set(reg.body.id, { ...store.userRows.get(reg.body.id)!, role });
    const login = await http().post('/api/auth/login').send({ email, password: PASSWORD }).expect(200);
    return { id: reg.body.id as string, accessToken: login.body.accessToken as string, refreshToken: login.body.refreshToken as string };
  }

  const login = (email: string) => http().post('/api/auth/login').send({ email, password: PASSWORD });

  it('tìm người dùng: superadmin thấy email đầy đủ, moderator thấy email đã che, member 403', async () => {
    const admin = await createAccount('admin1@example.com', 'superadmin');
    const mod = await createAccount('mod1@example.com', 'moderator');
    const member = await createAccount('khang@example.com');

    const full = await http().get('/api/admin/users?query=khang').set(as(admin.accessToken)).expect(200);
    expect(full.body).toMatchObject({ total: 1, page: 1, pageSize: 20 });
    expect(full.body.items[0]).toMatchObject({ email: 'khang@example.com', status: 'active', role: 'member' });

    const masked = await http().get('/api/admin/users?query=khang').set(as(mod.accessToken)).expect(200);
    expect(masked.body.items[0].email).toBe('kh***@example.com');

    await http().get('/api/admin/users').set(as(member.accessToken)).expect(403);
  });

  it('moderator không cấp quyền được; superadmin cấp quyền thì token cũ bị chặn ngay, đăng nhập lại có role mới', async () => {
    const admin = await createAccount('admin2@example.com', 'superadmin');
    const mod = await createAccount('mod2@example.com', 'moderator');
    const target = await createAccount('promote@example.com');

    await http().post('/api/admin/staff').set(as(mod.accessToken)).send({ userId: target.id }).expect(403);

    const granted = await http().post('/api/admin/staff').set(as(admin.accessToken)).send({ userId: target.id }).expect(200);
    expect(granted.body).toMatchObject({ id: target.id, role: 'moderator' });

    await http().get('/api/auth/me').set(as(target.accessToken)).expect(401);
    await http().post('/api/auth/refresh').send({ refreshToken: target.refreshToken }).expect(401);
    const relogin = await login('promote@example.com').expect(200);
    expect(decodeJwt(relogin.body.accessToken).role).toBe('moderator');
    await http().get('/api/admin/me').set(as(relogin.body.accessToken)).expect(200);

    const event = store.outboxRows.find((e) => e.type === 'access.user.role_changed' && e.userId === target.id);
    expect(event?.payload).toEqual({ userId: target.id, oldRole: 'member', newRole: 'moderator', changedBy: admin.id });
    expect(store.auditRows.some((a) => a.action === 'staff.role_granted')).toBe(true);

    const revoked = await http().delete(`/api/admin/staff/${target.id}`).set(as(admin.accessToken)).expect(200);
    expect(revoked.body.role).toBe('member');
    await http().get('/api/admin/me').set(as(relogin.body.accessToken)).expect(401);
  });

  it('khoá tài khoản: token cũ bị chặn, đăng nhập nhận lỗi chung; mở khoá thì đăng nhập lại được', async () => {
    const admin = await createAccount('admin3@example.com', 'superadmin');
    const target = await createAccount('lockme@example.com');

    const locked = await http().post(`/api/admin/users/${target.id}/lock`).set(as(admin.accessToken)).expect(200);
    expect(locked.body.status).toBe('locked');
    await http().get('/api/auth/me').set(as(target.accessToken)).expect(401);
    const denied = await login('lockme@example.com').expect(401);
    expect(denied.body.message).toBe(INVALID_CREDENTIALS_MESSAGE);
    expect(store.outboxRows.some((e) => e.type === 'access.user.locked' && e.userId === target.id)).toBe(true);

    await http().post(`/api/admin/users/${target.id}/unlock`).set(as(admin.accessToken)).expect(200);
    await login('lockme@example.com').expect(200);
    expect(store.outboxRows.some((e) => e.type === 'access.user.unlocked' && e.userId === target.id)).toBe(true);
  });

  it('quy tắc: không tự khoá mình, không đụng superadmin, không cấp quyền cho tài khoản bị khoá', async () => {
    const admin = await createAccount('admin4@example.com', 'superadmin');
    const otherAdmin = await createAccount('admin5@example.com', 'superadmin');
    const target = await createAccount('rules@example.com');

    await http().post(`/api/admin/users/${admin.id}/lock`).set(as(admin.accessToken)).expect(409);
    await http().delete(`/api/admin/staff/${otherAdmin.id}`).set(as(admin.accessToken)).expect(409);
    await http().post(`/api/admin/users/${otherAdmin.id}/lock`).set(as(admin.accessToken)).expect(409);
    await http().delete(`/api/admin/staff/${target.id}`).set(as(admin.accessToken)).expect(409);

    await http().post(`/api/admin/users/${target.id}/lock`).set(as(admin.accessToken)).expect(200);
    const res = await http().post('/api/admin/staff').set(as(admin.accessToken)).send({ userId: target.id }).expect(409);
    expect(res.body.message).toMatch(/đang bị khoá/);
  });

  it('mã người dùng sai định dạng thì 400, không tồn tại thì 404', async () => {
    const admin = await createAccount('admin6@example.com', 'superadmin');
    await http().post('/api/admin/users/khong-phai-uuid/lock').set(as(admin.accessToken)).expect(400);
    await http().post('/api/admin/users/0c6a1d3e-7f0e-4c39-9a7f-111111111111/lock').set(as(admin.accessToken)).expect(404);
    await http().post('/api/admin/staff').set(as(admin.accessToken)).send({ userId: 'x' }).expect(400);
  });
});
