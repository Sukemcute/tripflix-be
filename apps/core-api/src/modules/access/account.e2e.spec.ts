import { ACTION_RATE_LIMITER, MemoryActionRateLimiter } from './index.js';
import { registerTestAccount } from '../../platform/registration.fixture.js';
import 'reflect-metadata';
import { Global, type INestApplication, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MemorySidBlocklist } from '@tripflix/auth';
import { createNoOpTransactionalPlugins } from '@tripflix/db';
import { ClsModule } from 'nestjs-cls';
import request from 'supertest';
import type { CoreEnv } from '../../platform/env.js';
import { applyGlobalPrefix } from '../../platform/http.js';
import { CORE_ENV, DB_POOLS, REDIS } from '../../platform/tokens.js';
import { AccessModule } from './access.module.js';
import { WRONG_CURRENT_PASSWORD_MESSAGE } from './account/application/account.use-cases.js';
import { ACCESS_SID_BLOCKLIST, ACCESS_STORE, LOGIN_RATE_LIMITER } from './auth/application/ports.js';
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
const NEW_PASSWORD = 'mat-khau-moi-123';

describe('TF055: tài khoản của tôi', () => {
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
  });

  afterAll(async () => {
    await app.close();
  });

  const login = (email: string, deviceName: string, password = PASSWORD) =>
    http().post('/api/auth/login').send({ email, password, deviceName });

  /** Đăng ký rồi đăng nhập trên 2 thiết bị. */
  async function createAccountOnTwoDevices(email: string) {
    const reg = await registerTestAccount(app, { email, password: PASSWORD, displayName: 'Khang' });
    const phone = (await login(email, 'Pixel 8').expect(200)).body;
    const laptop = (await login(email, 'MacBook').expect(200)).body;
    return { userId: reg.body.id as string, phone, laptop };
  }

  it('PATCH /auth/me đổi tên hiển thị, phát access.user.profile_updated; tên trống 400; chưa đăng nhập 401', async () => {
    const { userId, phone } = await createAccountOnTwoDevices('rename@example.com');

    const res = await http().patch('/api/auth/me').set(as(phone.accessToken)).send({ displayName: '  Khang Nguyễn  ' }).expect(200);
    expect(res.body).toMatchObject({ id: userId, displayName: 'Khang Nguyễn', email: 'rename@example.com' });
    expect(res.body).not.toHaveProperty('passwordHash');
    expect((await http().get('/api/auth/me').set(as(phone.accessToken)).expect(200)).body.displayName).toBe('Khang Nguyễn');

    const events = store.outboxRows.filter((e) => e.type === 'access.user.profile_updated' && e.userId === userId);
    expect(events.map((e) => e.payload)).toEqual([{ userId, displayName: 'Khang Nguyễn' }]);
    expect(store.auditRows.some((a) => a.action === 'auth.profile_updated' && a.actorUserId === userId)).toBe(true);

    // Gửi lại cùng tên: không thêm sự kiện.
    await http().patch('/api/auth/me').set(as(phone.accessToken)).send({ displayName: 'Khang Nguyễn' }).expect(200);
    expect(store.outboxRows.filter((e) => e.type === 'access.user.profile_updated' && e.userId === userId)).toHaveLength(1);

    await http().patch('/api/auth/me').set(as(phone.accessToken)).send({ displayName: '   ' }).expect(400);
    await http().patch('/api/auth/me').send({ displayName: 'X' }).expect(401);
  });

  it('TF06M: GET/PATCH /auth/me có thông tin cá nhân; chuẩn hoá, xoá được; không lên event bus, audit không chứa giá trị', async () => {
    const { userId, phone } = await createAccountOnTwoDevices('personal@example.com');
    const me = (await http().get('/api/auth/me').set(as(phone.accessToken)).expect(200)).body;
    expect(me).toMatchObject({ id: userId, phone: null, dateOfBirth: null, gender: null, nationality: null });

    const res = await http()
      .patch('/api/auth/me')
      .set(as(phone.accessToken))
      .send({ phone: '0912 345.678', dateOfBirth: '2000-05-20', gender: 'female', nationality: 'vn' })
      .expect(200);
    expect(res.body).toMatchObject({ displayName: 'Khang', phone: '0912345678', dateOfBirth: '2000-05-20', gender: 'female', nationality: 'VN' });
    expect((await http().get('/api/auth/me').set(as(phone.accessToken)).expect(200)).body).toMatchObject({ phone: '0912345678', nationality: 'VN' });

    // Chỉ đổi thông tin cá nhân: không phát access.user.profile_updated; audit chỉ ghi tên trường.
    expect(store.outboxRows.filter((e) => e.type === 'access.user.profile_updated' && e.userId === userId)).toHaveLength(0);
    const audit = store.auditRows.filter((a) => a.action === 'auth.profile_updated' && a.actorUserId === userId);
    expect(audit).toHaveLength(1);
    expect(audit[0]!.meta).toEqual({ changedFields: ['phone', 'dateOfBirth', 'gender', 'nationality'] });
    expect(JSON.stringify(audit[0])).not.toContain('0912345678');

    // Xoá bằng "" hoặc null; trường không gửi giữ nguyên.
    const cleared = await http().patch('/api/auth/me').set(as(phone.accessToken)).send({ phone: '', gender: null }).expect(200);
    expect(cleared.body).toMatchObject({ phone: null, gender: null, dateOfBirth: '2000-05-20', nationality: 'VN' });

    // Đổi tên cùng lúc với thông tin cá nhân: phát sự kiện, chỉ có tên.
    await http().patch('/api/auth/me').set(as(phone.accessToken)).send({ displayName: 'Lan', phone: '+84912345678' }).expect(200);
    const events = store.outboxRows.filter((e) => e.type === 'access.user.profile_updated' && e.userId === userId);
    expect(events.map((e) => e.payload)).toEqual([{ userId, displayName: 'Lan' }]);
  });

  it('TF06M: PATCH /auth/me sai định dạng trả 400 kèm trường sai; body rỗng 400', async () => {
    const { phone } = await createAccountOnTwoDevices('personal-bad@example.com');
    const nextYear = `${new Date().getUTCFullYear() + 1}-01-01`;
    const tooYoung = `${new Date().getUTCFullYear() - 5}-01-01`;
    for (const [body, field] of [
      [{ phone: '12ab' }, 'phone'],
      [{ phone: '1234567' }, 'phone'],
      [{ dateOfBirth: '20-05-2000' }, 'dateOfBirth'],
      [{ dateOfBirth: nextYear }, 'dateOfBirth'],
      [{ dateOfBirth: tooYoung }, 'dateOfBirth'],
      [{ gender: 'unknown' }, 'gender'],
      [{ nationality: 'VNM' }, 'nationality'],
    ] as const) {
      const res = await http().patch('/api/auth/me').set(as(phone.accessToken)).send(body).expect(400);
      expect(res.body.errors.map((e: { field: string }) => e.field)).toContain(field);
    }
    await http().patch('/api/auth/me').set(as(phone.accessToken)).send({}).expect(400);
  });

  it('GET /auth/sessions liệt kê thiết bị, đánh dấu phiên hiện tại; không có bản băm token', async () => {
    const { phone } = await createAccountOnTwoDevices('sessions@example.com');

    const res = await http().get('/api/auth/sessions').set(as(phone.accessToken)).expect(200);
    expect(res.body).toHaveLength(2);
    expect(res.body.map((s: { deviceName: string }) => s.deviceName).sort()).toEqual(['MacBook', 'Pixel 8']);
    expect(res.body.filter((s: { isCurrent: boolean }) => s.isCurrent).map((s: { deviceName: string }) => s.deviceName)).toEqual([
      'Pixel 8',
    ]);
    expect(Object.keys(res.body[0]).sort()).toEqual(['createdAt', 'deviceName', 'id', 'isCurrent', 'lastUsedAt', 'userAgent']);
  });

  it('thoát một thiết bị: token máy đó 401 ngay, máy khác vẫn dùng được; phiên của người khác 404', async () => {
    const { phone, laptop } = await createAccountOnTwoDevices('revoke@example.com');
    const other = await createAccountOnTwoDevices('other@example.com');

    const sessions = (await http().get('/api/auth/sessions').set(as(phone.accessToken)).expect(200)).body;
    const laptopSession = sessions.find((s: { deviceName: string }) => s.deviceName === 'MacBook');

    // Người khác xoá phiên của mình: 404 như phiên không tồn tại, phiên vẫn còn.
    await http().delete(`/api/auth/sessions/${laptopSession.id}`).set(as(other.phone.accessToken)).expect(404);
    await http().get('/api/auth/me').set(as(laptop.accessToken)).expect(200);

    await http().delete(`/api/auth/sessions/${laptopSession.id}`).set(as(phone.accessToken)).expect(204);
    await http().get('/api/auth/me').set(as(laptop.accessToken)).expect(401);
    await http().post('/api/auth/refresh').send({ refreshToken: laptop.refreshToken }).expect(401);
    await http().get('/api/auth/me').set(as(phone.accessToken)).expect(200);

    // Xoá lần nữa: phiên không còn.
    await http().delete(`/api/auth/sessions/${laptopSession.id}`).set(as(phone.accessToken)).expect(404);
    await http().delete('/api/auth/sessions/khong-phai-uuid').set(as(phone.accessToken)).expect(400);
  });

  it('đổi mật khẩu: sai mật khẩu cũ 400; xong thì máy khác bị đăng xuất, máy này dùng tiếp; mật khẩu cũ hết dùng được', async () => {
    const email = 'change@example.com';
    const { userId, phone, laptop } = await createAccountOnTwoDevices(email);
    const change = (body: object) => http().post('/api/auth/password/change').set(as(phone.accessToken)).send(body);

    const wrong = await change({ currentPassword: 'sai-mat-khau', newPassword: NEW_PASSWORD }).expect(400);
    expect(wrong.body.message).toBe(WRONG_CURRENT_PASSWORD_MESSAGE);
    await change({ currentPassword: PASSWORD, newPassword: PASSWORD }).expect(400);
    await change({ currentPassword: PASSWORD, newPassword: 'ngan' }).expect(400);

    await change({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD }).expect(204);
    await http().get('/api/auth/me').set(as(laptop.accessToken)).expect(401);
    await http().post('/api/auth/refresh').send({ refreshToken: laptop.refreshToken }).expect(401);
    await http().get('/api/auth/me').set(as(phone.accessToken)).expect(200);
    await http().post('/api/auth/refresh').send({ refreshToken: phone.refreshToken }).expect(200);

    await login(email, 'Pixel 8').expect(401);
    await login(email, 'Pixel 8', NEW_PASSWORD).expect(200);
    expect(store.auditRows.filter((a) => a.actorUserId === userId).map((a) => a.action)).toEqual(
      expect.arrayContaining(['auth.password_change_failed', 'auth.password_changed']),
    );
  });

  it('sai mật khẩu hiện tại tính vào giới hạn đăng nhập sai: tới lần thứ 6 nhận 429', async () => {
    const { phone } = await createAccountOnTwoDevices('bruteforce@example.com');
    for (let i = 0; i < 5; i += 1) {
      await http()
        .post('/api/auth/password/change')
        .set(as(phone.accessToken))
        .send({ currentPassword: `sai-${i}-mat-khau`, newPassword: NEW_PASSWORD })
        .expect(400);
    }
    const blocked = await http()
      .post('/api/auth/password/change')
      .set(as(phone.accessToken))
      .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD })
      .expect(429);
    expect(blocked.headers['retry-after']).toBeDefined();
  });

  it('POST /auth/logout-all: mọi thiết bị, kể cả máy đang gọi, nhận 401', async () => {
    const { userId, phone, laptop } = await createAccountOnTwoDevices('all@example.com');
    await http().post('/api/auth/logout-all').set(as(phone.accessToken)).expect(204);
    await http().get('/api/auth/me').set(as(phone.accessToken)).expect(401);
    await http().get('/api/auth/me').set(as(laptop.accessToken)).expect(401);
    await http().post('/api/auth/refresh').send({ refreshToken: phone.refreshToken }).expect(401);
    expect([...store.sessionRows.values()].filter((s) => s.userId === userId)).toHaveLength(0);
  });
});
