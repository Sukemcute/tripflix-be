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
import { FORGOT_ACCEPTED_MESSAGE } from './account/domain/password-reset.js';
import {
  ACCESS_SID_BLOCKLIST,
  ACCESS_STORE,
  ACTION_RATE_LIMITER,
  LOGIN_RATE_LIMITER,
} from './auth/application/ports.js';
import { MemoryAccessStore } from './auth/infra/memory/memory-access.store.js';
import { MemoryActionRateLimiter } from './auth/infra/memory/memory-action-rate-limiter.js';
import { MemoryLoginRateLimiter } from './auth/infra/memory/memory-login-rate-limiter.js';

const env = {
  NODE_ENV: 'test',
  AUTH_JWT_ISSUER: 'tripflix-core',
  AUTH_JWT_AUDIENCE: 'tripflix',
  AUTH_PASSWORD_RESET_URL: 'https://tripflix.example/dat-lai-mat-khau',
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
const INVALID = 'Dữ liệu gửi lên không hợp lệ';
const ZWSP = String.fromCodePoint(0x200b);

/** TF05C: kiểm đầu vào qua HTTP thật (Nest + supertest), store trong bộ nhớ. */
describe('TF05C: kiểm dữ liệu đầu vào của access qua HTTP', () => {
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

  async function createAccount(email: string, role?: 'superadmin') {
    const reg = await http()
      .post('/api/auth/register')
      .send({ email, password: PASSWORD, displayName: 'Lan' })
      .expect(201);
    if (role) store.userRows.set(reg.body.id, { ...store.userRows.get(reg.body.id)!, role });
    const login = await http().post('/api/auth/login').send({ email, password: PASSWORD }).expect(200);
    return { id: reg.body.id as string, accessToken: login.body.accessToken as string };
  }

  /** Lỗi kiểm dữ liệu luôn cùng một dạng: đúng hai khoá message (câu chung) và errors (field + message tiếng Việt). */
  function expectFieldErrors(body: unknown, fields: string[]) {
    expect(Object.keys(body as object).sort()).toEqual(['errors', 'message']);
    expect(body).toMatchObject({ message: INVALID });
    const errors = (body as { errors: { field: string; message: string }[] }).errors;
    expect(errors.map((e) => e.field)).toEqual(fields);
    for (const e of errors)
      expect(
        typeof e.message === 'string' &&
          e.message.length > 0 &&
          !/expected|received|Invalid/i.test(e.message),
      ).toBe(true);
  }

  it('JSON hỏng: 400, không phải 500', async () => {
    const res = await http()
      .post('/api/auth/register')
      .set('Content-Type', 'application/json')
      .send('{"email": "a@x.com",');
    expect(res.status).toBe(400);
  });

  it('không gửi body hoặc gửi sai Content-Type (body không được đọc): 400 một lỗi ở gốc', async () => {
    const root = [{ field: '', message: 'Dữ liệu gửi lên phải là một đối tượng JSON' }];
    expect((await http().post('/api/auth/register').expect(400)).body.errors).toEqual(root);
    const text = await http()
      .post('/api/auth/register')
      .set('Content-Type', 'text/plain')
      .send('email=a@x.com')
      .expect(400);
    expect(text.body.errors).toEqual(root);
  });

  it('body JSON rỗng {}: 400 kèm đủ các trường thiếu', async () => {
    expectFieldErrors((await http().post('/api/auth/register').send({}).expect(400)).body, [
      'email',
      'password',
      'displayName',
    ]);
  });

  it('body là mảng hoặc chuỗi JSON: 400 báo ở gốc', async () => {
    const arr = await http()
      .post('/api/auth/login')
      .send([{ email: 'a@x.com' }])
      .expect(400);
    expect(arr.body.errors).toEqual([{ field: '', message: 'Dữ liệu gửi lên phải là một đối tượng JSON' }]);
  });

  it('đăng ký: email có khoảng trắng, chữ hoa được nhận và lưu chữ thường; đăng nhập lại bằng cách gõ khác vẫn được', async () => {
    const reg = await http()
      .post('/api/auth/register')
      .send({ email: '  Trim.Case@Example.COM  ', password: PASSWORD, displayName: '  Lan  ' })
      .expect(201);
    expect(reg.body).toMatchObject({ email: 'trim.case@example.com', displayName: 'Lan', role: 'member' });
    await http()
      .post('/api/auth/login')
      .send({ email: ' TRIM.case@example.com', password: PASSWORD })
      .expect(200);
  });

  it('đăng ký: gửi role, status thì bị bỏ, tài khoản vẫn là member', async () => {
    const reg = await http()
      .post('/api/auth/register')
      .send({
        email: 'role-inject@example.com',
        password: PASSWORD,
        displayName: 'Lan',
        role: 'superadmin',
        status: 'locked',
      })
      .expect(201);
    expect(reg.body.role).toBe('member');
    expect(store.userRows.get(reg.body.id)).toMatchObject({ role: 'member', status: 'active' });
  });

  it.each([
    ['mật khẩu toàn dấu cách', { password: ' '.repeat(12) }, ['password']],
    ['mật khẩu toàn ký tự zero-width', { password: ZWSP.repeat(12) }, ['password']],
    ['tên nhiều dòng', { displayName: 'Lan\nAnh' }, ['displayName']],
    ['tên vô hình', { displayName: ZWSP }, ['displayName']],
    ['email sai', { email: 'lan@' }, ['email']],
    ['sai cả ba', { email: 1, password: '1', displayName: '' }, ['email', 'password', 'displayName']],
  ])('đăng ký: %s → 400 đúng trường, không tạo tài khoản', async (_, patch, fields) => {
    const before = store.userRows.size;
    const res = await http()
      .post('/api/auth/register')
      .send({ email: `reject-${Date.now()}@example.com`, password: PASSWORD, displayName: 'Lan', ...patch })
      .expect(400);
    expectFieldErrors(res.body, fields);
    expect(store.userRows.size).toBe(before);
  });

  it('đăng nhập: tên thiết bị trống lưu null, nhiều dòng thì gộp thành một dòng', async () => {
    const { accessToken } = await createAccount('device@example.com');
    await http()
      .post('/api/auth/login')
      .send({ email: 'device@example.com', password: PASSWORD, deviceName: '   ' })
      .expect(200);
    await http()
      .post('/api/auth/login')
      .send({ email: 'device@example.com', password: PASSWORD, deviceName: 'Pixel\n8' })
      .expect(200);
    const sessions = await http().get('/api/auth/sessions').set(as(accessToken)).expect(200);
    const names = sessions.body.map((s: { deviceName: string | null }) => s.deviceName);
    expect(names).toEqual(expect.arrayContaining([null, 'Pixel 8']));
    expect(names).not.toContain('');
  });

  it('đăng nhập: sai kiểu, thiếu trường → 400 có errors (khác lỗi sai mật khẩu 401)', async () => {
    expectFieldErrors((await http().post('/api/auth/login').send({ email: 'a@x.com' }).expect(400)).body, [
      'password',
    ]);
    expectFieldErrors(
      (
        await http()
          .post('/api/auth/login')
          .send({ email: ['a@x.com'], password: 1 })
          .expect(400)
      ).body,
      ['email', 'password'],
    );
    await http()
      .post('/api/auth/login')
      .send({ email: 'device@example.com', password: 'sai-mat-khau' })
      .expect(401);
  });

  it('Google: idToken trống → 400 (kiểm dữ liệu chạy trước, kể cả khi chưa cấu hình Google)', async () => {
    expectFieldErrors((await http().post('/api/auth/google').send({ idToken: '' }).expect(400)).body, [
      'idToken',
    ]);
  });

  it('refresh: token sai kiểu → 400', async () => {
    expectFieldErrors((await http().post('/api/auth/refresh').send({ refreshToken: 123 }).expect(400)).body, [
      'refreshToken',
    ]);
  });

  describe('PATCH /auth/me', () => {
    let token: string;
    let userId: string;
    beforeAll(async () => {
      const acc = await createAccount('profile-validate@example.com');
      token = acc.accessToken;
      userId = acc.id;
    });

    it('chuẩn hoá: số điện thoại bỏ dấu, quốc tịch viết hoa, tên cắt khoảng trắng', async () => {
      const res = await http()
        .patch('/api/auth/me')
        .set(as(token))
        .send({
          displayName: '  Lan Anh ',
          phone: '+84 912-345.678',
          nationality: ' vn ',
          gender: 'female',
          dateOfBirth: '2000-02-29',
        })
        .expect(200);
      expect(res.body).toMatchObject({
        displayName: 'Lan Anh',
        phone: '+84912345678',
        nationality: 'VN',
        gender: 'female',
        dateOfBirth: '2000-02-29',
      });
    });

    it('gửi email, role, status kèm theo: không đổi được', async () => {
      const res = await http()
        .patch('/api/auth/me')
        .set(as(token))
        .send({ displayName: 'Lan', email: 'hack@example.com', role: 'superadmin', status: 'locked' })
        .expect(200);
      expect(res.body).toMatchObject({
        email: 'profile-validate@example.com',
        role: 'member',
        displayName: 'Lan',
      });
      expect(store.userRows.get(userId)).toMatchObject({
        email: 'profile-validate@example.com',
        role: 'member',
        status: 'active',
      });
    });

    it('chỉ gửi trường lạ: 400 "Cần ít nhất một trường"', async () => {
      const res = await http()
        .patch('/api/auth/me')
        .set(as(token))
        .send({ email: 'hack@example.com' })
        .expect(400);
      expect(res.body.errors).toEqual([{ field: '', message: 'Cần ít nhất một trường để cập nhật' }]);
    });

    it.each([
      [{ nationality: 'XX' }, ['nationality']],
      [{ nationality: 'EU' }, ['nationality']],
      [{ dateOfBirth: '2001-02-29' }, ['dateOfBirth']],
      [{ displayName: 'Lan\tAnh' }, ['displayName']],
      [{ phone: '+84 912 345 678 999 99' }, ['phone']], // 16 chữ số
      [{ gender: 'nam', nationality: 'ZZ', phone: 'abc' }, ['phone', 'gender', 'nationality']],
    ])('từ chối %j, dữ liệu cũ giữ nguyên', async (body, fields) => {
      const before = { ...store.userRows.get(userId)! };
      const res = await http().patch('/api/auth/me').set(as(token)).send(body).expect(400);
      expectFieldErrors(res.body, fields);
      expect(store.userRows.get(userId)).toEqual(before);
    });

    it('xoá thông tin bằng null và "": trả null', async () => {
      const res = await http()
        .patch('/api/auth/me')
        .set(as(token))
        .send({ phone: '', nationality: null, gender: '', dateOfBirth: null })
        .expect(200);
      expect(res.body).toMatchObject({ phone: null, nationality: null, gender: null, dateOfBirth: null });
    });
  });

  it('đổi mật khẩu: mật khẩu mới toàn khoảng trắng → 400 có errors (FE phân biệt với sai mật khẩu cũ)', async () => {
    const { accessToken } = await createAccount('change-ws@example.com');
    const res = await http()
      .post('/api/auth/password/change')
      .set(as(accessToken))
      .send({ currentPassword: PASSWORD, newPassword: ' '.repeat(10) })
      .expect(400);
    expectFieldErrors(res.body, ['newPassword']);
    await http()
      .post('/api/auth/login')
      .send({ email: 'change-ws@example.com', password: PASSWORD })
      .expect(200);
  });

  it('quên mật khẩu: email trống 400; email sai định dạng vẫn 202 câu chung (không lộ email nào đã có)', async () => {
    expectFieldErrors(
      (await http().post('/api/auth/password/forgot').send({ email: '  ' }).expect(400)).body,
      ['email'],
    );
    const res = await http()
      .post('/api/auth/password/forgot')
      .send({ email: 'khong-phai-email' })
      .expect(202);
    expect(res.body.message).toBe(FORGOT_ACCEPTED_MESSAGE);
  });

  it('đặt lại mật khẩu: mật khẩu mới toàn khoảng trắng → 400 có errors, token trống → 400', async () => {
    expectFieldErrors(
      (
        await http()
          .post('/api/auth/password/reset')
          .send({ token: 'x', newPassword: ' '.repeat(9) })
          .expect(400)
      ).body,
      ['newPassword'],
    );
    expectFieldErrors(
      (await http().post('/api/auth/password/reset').send({ token: '', newPassword: PASSWORD }).expect(400))
        .body,
      ['token'],
    );
  });

  it('admin: page sai → 400 có errors; id trong URL sai → 400 câu tiếng Việt', async () => {
    const admin = await createAccount('admin-validate@example.com', 'superadmin');
    for (const page of ['abc', '0', '1.5', '1001']) {
      expectFieldErrors(
        (await http().get(`/api/admin/users?page=${page}`).set(as(admin.accessToken)).expect(400)).body,
        ['page'],
      );
    }
    const badId = await http()
      .post('/api/admin/users/khong-phai-uuid/lock')
      .set(as(admin.accessToken))
      .expect(400);
    expect(badId.body.message).toBe('Mã người dùng không hợp lệ');
    expectFieldErrors(
      (await http().post('/api/admin/staff').set(as(admin.accessToken)).send({ userId: 'x' }).expect(400))
        .body,
      ['userId'],
    );
  });

  it('service token: thiếu trường → 400 đủ cả ba', async () => {
    expectFieldErrors((await http().post('/api/auth/service-token').send({}).expect(400)).body, [
      'clientId',
      'clientSecret',
      'audience',
    ]);
  });
});
