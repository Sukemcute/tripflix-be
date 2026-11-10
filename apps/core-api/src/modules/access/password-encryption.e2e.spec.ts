import 'reflect-metadata';
import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MemorySidBlocklist } from '@tripflix/auth';
import { createNoOpTransactionalPlugins } from '@tripflix/db';
import { ClsModule } from 'nestjs-cls';
import request from 'supertest';
import type { CoreEnv } from '../../platform/env.js';
import { applyGlobalPrefix } from '../../platform/http.js';
import { prepareTestRegistration, SIGNUP_PROFILE } from '../../platform/registration.fixture.js';
import { CORE_ENV, DB_POOLS, REDIS } from '../../platform/tokens.js';
import { AccessModule } from './access.module.js';
import {
  PASSWORD_ENCRYPTION_REQUIRED_CODE,
  PASSWORD_ENVELOPE_INVALID_CODE,
} from './auth/api/encrypted-passwords.js';
import {
  ACCESS_SID_BLOCKLIST,
  ACCESS_STORE,
  ACTION_RATE_LIMITER,
  LOGIN_RATE_LIMITER,
  PASSWORD_HASHER,
} from './auth/application/ports.js';
import type { PasswordPurpose } from './auth/domain/password-envelope.js';
import { MemoryAccessStore } from './auth/infra/memory/memory-access.store.js';
import { MemoryActionRateLimiter } from './auth/infra/memory/memory-action-rate-limiter.js';
import { MemoryLoginRateLimiter } from './auth/infra/memory/memory-login-rate-limiter.js';
import { createTestPasswordHasher } from './auth/infra/test-password-hasher.js';
import { encryptPasswordForTest } from './auth/infra/test-password-envelope.js';

// TF056: mật khẩu mã hoá trong client (kiểu Facebook #PWD_BROWSER). App Nest thật, database và Redis bằng bản bộ nhớ.
const PASSWORD = 'mat-khau-an-toan';

async function createApp(extraEnv: Partial<CoreEnv> = {}) {
  const env = {
    NODE_ENV: 'test',
    AUTH_JWT_ISSUER: 'tripflix-core',
    AUTH_JWT_AUDIENCE: 'tripflix',
    ...extraEnv,
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

  const store = new MemoryAccessStore();
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
    .overrideProvider(PASSWORD_HASHER)
    .useValue(createTestPasswordHasher())
    .overrideProvider(LOGIN_RATE_LIMITER)
    .useValue(new MemoryLoginRateLimiter())
    .overrideProvider(ACCESS_SID_BLOCKLIST)
    .useValue(new MemorySidBlocklist())
    .compile();
  const app = moduleRef.createNestApplication({ logger: false });
  applyGlobalPrefix(app);
  // Lắng nghe sẵn một cổng: test lấy khoá (một request) trong lúc dựng request khác, supertest không mở server hai lần.
  await app.listen(0, '127.0.0.1');
  const http = () => request(app.getHttpServer());

  const key = async () =>
    (await http().get('/api/auth/password-key').expect(200)).body as { keyId: string; publicKey: string };
  const enc = async (password: string, purpose: PasswordPurpose, email = '') =>
    encryptPasswordForTest(await key(), password, { purpose, subject: email.trim().toLowerCase() });

  async function register(email: string, displayName = email) {
    const proof = await prepareTestRegistration(app, email);
    return http()
      .post('/api/auth/register')
      .send({
        ...SIGNUP_PROFILE,
        email,
        displayName,
        encPassword: await enc(PASSWORD, 'register', email),
        ...proof,
      });
  }

  return { app, store, http, key, enc, register };
}

describe('TF056: mật khẩu mã hoá trước khi gửi', () => {
  let t: Awaited<ReturnType<typeof createApp>>;

  beforeAll(async () => {
    t = await createApp();
  });

  afterAll(async () => {
    await t.app.close();
  });

  it('GET /auth/password-key trả khoá công khai X25519, không cache', async () => {
    const res = await t.http().get('/api/auth/password-key').expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toMatchObject({ keyId: 'dev', algorithm: 'X25519-HKDF-SHA256-A256GCM', version: 1 });
    expect(Buffer.from(res.body.publicKey, 'base64url')).toHaveLength(32);
    expect(Math.abs(res.body.serverTime - Date.now() / 1000)).toBeLessThan(5);
  });

  it('xin mã đăng ký chỉ cần email; app cũ còn gửi password cũng không lỗi', async () => {
    await t.http().post('/api/auth/registration-code').send({ email: 'otp-only@example.com' }).expect(202);
    await t
      .http()
      .post('/api/auth/registration-code')
      .send({ email: 'otp-old@example.com', password: PASSWORD })
      .expect(202);
  });

  it('đăng ký và đăng nhập bằng encPassword; server lưu Argon2 như cũ', async () => {
    const reg = await t.register('Lan@Example.com', 'Lan');
    expect(reg.status).toBe(201);
    expect(t.store.userRows.get(reg.body.id)!.passwordHash).toMatch(/^\$argon2id\$/);
    const login = await t
      .http()
      .post('/api/auth/login')
      .send({ email: 'lan@example.com', encPassword: await t.enc(PASSWORD, 'login', 'lan@example.com') })
      .expect(200);
    expect(login.body.tokenType).toBe('Bearer');
  });

  it('mật khẩu yếu gửi bằng encPassword vẫn bị luật mật khẩu chặn, lỗi báo ở trường password', async () => {
    const email = 'weak@example.com';
    const proof = await prepareTestRegistration(t.app, email);
    const res = await t
      .http()
      .post('/api/auth/register')
      .send({
        ...SIGNUP_PROFILE,
        email,
        displayName: 'Yếu',
        encPassword: await t.enc('Password123456', 'register', email),
        ...proof,
      })
      .expect(400);
    expect(res.body.errors).toEqual([expect.objectContaining({ field: 'password' })]);
    expect(JSON.stringify(res.body)).not.toContain('Password123456');
  });

  it('gửi lại đúng chuỗi mã hoá đã dùng (replay): 400, không đăng nhập được', async () => {
    await t.register('replay@example.com');
    const encPassword = await t.enc(PASSWORD, 'login', 'replay@example.com');
    await t.http().post('/api/auth/login').send({ email: 'replay@example.com', encPassword }).expect(200);
    const again = await t
      .http()
      .post('/api/auth/login')
      .send({ email: 'replay@example.com', encPassword })
      .expect(400);
    expect(again.body).toMatchObject({
      code: PASSWORD_ENVELOPE_INVALID_CODE,
      errors: [expect.objectContaining({ field: 'encPassword' })],
    });
  });

  it('chuỗi mã hoá cho email khác hoặc cho việc khác: 400', async () => {
    await t.register('owner@example.com');
    const forOther = await t.enc(PASSWORD, 'login', 'someone@example.com');
    await t
      .http()
      .post('/api/auth/login')
      .send({ email: 'owner@example.com', encPassword: forOther })
      .expect(400);
    const forRegister = await t.enc(PASSWORD, 'register', 'owner@example.com');
    await t
      .http()
      .post('/api/auth/login')
      .send({ email: 'owner@example.com', encPassword: forRegister })
      .expect(400);
  });

  it('chuỗi rác hoặc gửi cả password lẫn encPassword: 400', async () => {
    await t
      .http()
      .post('/api/auth/login')
      .send({ email: 'x@example.com', encPassword: '#TFPWD:1:dev:1:AAAA' })
      .expect(400);
    await t.http().post('/api/auth/login').send({ email: 'x@example.com', encPassword: 123 }).expect(400);
    const both = await t
      .http()
      .post('/api/auth/login')
      .send({
        email: 'x@example.com',
        password: PASSWORD,
        encPassword: await t.enc(PASSWORD, 'login', 'x@example.com'),
      })
      .expect(400);
    expect(both.body.errors).toEqual([expect.objectContaining({ field: 'encPassword' })]);
  });

  it('mật khẩu sai nhưng mã hoá đúng: 401 như cũ (không lộ gì thêm)', async () => {
    await t.register('wrong@example.com');
    await t
      .http()
      .post('/api/auth/login')
      .send({
        email: 'wrong@example.com',
        encPassword: await t.enc('mat-khau-sai-roi', 'login', 'wrong@example.com'),
      })
      .expect(401);
  });

  it('chưa bắt buộc: client cũ gửi password thường vẫn đăng nhập được', async () => {
    await t.register('legacy-client@example.com');
    await t
      .http()
      .post('/api/auth/login')
      .send({ email: 'legacy-client@example.com', password: PASSWORD })
      .expect(200);
  });

  it('đổi mật khẩu bằng encCurrentPassword và encNewPassword', async () => {
    await t.register('change@example.com');
    const login = await t
      .http()
      .post('/api/auth/login')
      .send({ email: 'change@example.com', password: PASSWORD })
      .expect(200);
    await t
      .http()
      .post('/api/auth/password/change')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .send({
        encCurrentPassword: await t.enc(PASSWORD, 'change_current'),
        encNewPassword: await t.enc('mat-khau-moi-123', 'change_new'),
      })
      .expect(204);
    await t
      .http()
      .post('/api/auth/login')
      .send({ email: 'change@example.com', password: 'mat-khau-moi-123' })
      .expect(200);
  });

  it('đặt lại mật khẩu bằng encNewPassword', async () => {
    const reg = await t.register('reset@example.com');
    await t.http().post('/api/auth/password/forgot').send({ email: 'reset@example.com' }).expect(202);
    const event = t.store.outboxRows.findLast(
      (e) => e.type === 'access.password_reset_requested' && e.userId === reg.body.id,
    )!;
    const token = new URL(String(event.payload.resetUrl)).searchParams.get('token');
    await t
      .http()
      .post('/api/auth/password/reset')
      .send({ token, encNewPassword: await t.enc('mat-khau-dat-lai', 'reset') })
      .expect(204);
    await t
      .http()
      .post('/api/auth/login')
      .send({ email: 'reset@example.com', password: 'mat-khau-dat-lai' })
      .expect(200);
  });

  describe('superadmin tạo nhân sự: không còn mật khẩu mặc định', () => {
    let adminToken: string;

    beforeAll(async () => {
      const reg = await t.register('super@example.com');
      const row = t.store.userRows.get(reg.body.id)!;
      t.store.userRows.set(row.id, { ...row, role: 'superadmin' });
      adminToken = (
        await t
          .http()
          .post('/api/auth/login')
          .send({ email: 'super@example.com', password: PASSWORD })
          .expect(200)
      ).body.accessToken;
    });

    const create = (body: Record<string, unknown>) =>
      t.http().post('/api/admin/users').set('Authorization', `Bearer ${adminToken}`).send(body);

    it('bỏ trống mật khẩu: tài khoản chưa có mật khẩu, nhân sự nhận email đặt mật khẩu, "Tripflix@2025" không đăng nhập được', async () => {
      const res = await create({ email: 'Mod1@Tripflix.vn', displayName: 'Kiểm duyệt 1' }).expect(201);
      expect(t.store.userRows.get(res.body.id)!.passwordHash).toBeNull();
      const mail = t.store.outboxRows.find(
        (e) => e.type === 'access.password_reset_requested' && e.userId === res.body.id,
      );
      expect(mail?.payload).toMatchObject({ email: 'mod1@tripflix.vn' });
      await t
        .http()
        .post('/api/auth/login')
        .send({ email: 'mod1@tripflix.vn', password: 'Tripflix@2025' })
        .expect(401);
    });

    it('đặt mật khẩu bằng encPassword: nhân sự đăng nhập được bằng đúng mật khẩu đó', async () => {
      const encPassword = await t.enc('mat-khau-nhan-su', 'staff_create', 'mod2@tripflix.vn');
      const res = await create({
        email: 'mod2@tripflix.vn',
        displayName: 'Kiểm duyệt 2',
        encPassword,
      }).expect(201);
      expect(
        t.store.outboxRows.some(
          (e) => e.type === 'access.password_reset_requested' && e.userId === res.body.id,
        ),
      ).toBe(false);
      await t
        .http()
        .post('/api/auth/login')
        .send({ email: 'mod2@tripflix.vn', password: 'mat-khau-nhan-su' })
        .expect(200);
    });

    it('mật khẩu chỉ có khoảng trắng hoặc quá ngắn: 400 (trước đây bị cắt khoảng trắng rồi thay bằng mật khẩu mặc định)', async () => {
      await create({ email: 'mod3@tripflix.vn', displayName: 'Kiểm duyệt 3', password: '          ' }).expect(
        400,
      );
      await create({ email: 'mod3@tripflix.vn', displayName: 'Kiểm duyệt 3', password: 'ngan' }).expect(400);
    });
  });
});

describe('TF056: bắt buộc mã hoá (AUTH_PASSWORD_ENCRYPTION_REQUIRED=true)', () => {
  let t: Awaited<ReturnType<typeof createApp>>;

  beforeAll(async () => {
    t = await createApp({ AUTH_PASSWORD_ENCRYPTION_REQUIRED: true });
  });

  afterAll(async () => {
    await t.app.close();
  });

  it('gửi password thường: 400 với mã password_encryption_required; gửi encPassword: đăng nhập được', async () => {
    await t.register('required@example.com').then((r) => expect(r.status).toBe(201));
    const plain = await t
      .http()
      .post('/api/auth/login')
      .send({ email: 'required@example.com', password: PASSWORD })
      .expect(400);
    expect(plain.body).toMatchObject({
      code: PASSWORD_ENCRYPTION_REQUIRED_CODE,
      errors: [expect.objectContaining({ field: 'password' })],
    });
    await t
      .http()
      .post('/api/auth/login')
      .send({
        email: 'required@example.com',
        encPassword: await t.enc(PASSWORD, 'login', 'required@example.com'),
      })
      .expect(200);
  });
});
