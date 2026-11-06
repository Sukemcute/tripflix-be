import 'reflect-metadata';
import { Controller, Global, type INestApplication, Module, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { EMAIL_UNVERIFIED_CODE, MemorySidBlocklist, RequireVerifiedEmail } from '@tripflix/auth';
import { AccessEmailVerificationRequestedV1Schema } from '@tripflix/contracts';
import { createNoOpTransactionalPlugins } from '@tripflix/db';
import { decodeJwt } from 'jose';
import { ClsModule } from 'nestjs-cls';
import request from 'supertest';
import type { CoreEnv } from '../../platform/env.js';
import { applyGlobalPrefix } from '../../platform/http.js';
import { CORE_ENV, DB_POOLS, REDIS } from '../../platform/tokens.js';
import { AccessModule } from './access.module.js';
import { EmailVerificationUseCases } from './account/application/email-verification.use-cases.js';
import { seedLegacyAccount } from '../../platform/registration.fixture.js';
import {
  REGISTRATION_CODE_COOLDOWN_MESSAGE,
  REGISTRATION_CODE_COOLDOWN_SECONDS,
} from './auth/domain/registration.js';
import {
  INVALID_VERIFY_TOKEN_MESSAGE,
  REGISTER_WINDOW_SECONDS,
  TOO_MANY_RESENDS_MESSAGE,
  TOO_MANY_SIGNUPS_MESSAGE,
} from './account/domain/email-verification.js';
import {
  ACCESS_SID_BLOCKLIST,
  ACCESS_STORE,
  ACTION_RATE_LIMITER,
  LOGIN_RATE_LIMITER,
} from './auth/application/ports.js';
import { MemoryAccessStore } from './auth/infra/memory/memory-access.store.js';
import { MemoryActionRateLimiter } from './auth/infra/memory/memory-action-rate-limiter.js';
import { MemoryLoginRateLimiter } from './auth/infra/memory/memory-login-rate-limiter.js';

const VERIFY_PAGE = 'https://tripflix.example/xac-thuc-email';
const REGISTER_LIMIT = 5;
const env = {
  NODE_ENV: 'test',
  AUTH_JWT_ISSUER: 'tripflix-core',
  AUTH_JWT_AUDIENCE: 'tripflix',
  AUTH_PASSWORD_RESET_URL: 'https://tripflix.example/dat-lai-mat-khau',
  AUTH_EMAIL_VERIFY_URL: VERIFY_PAGE,
  AUTH_REGISTER_MAX_PER_IP_HOUR: REGISTER_LIMIT,
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

/** Controller giả như "tạo bài" của content: chỉ để kiểm RequireVerifiedEmail với token thật. */
@Controller('v1/probe')
class ProbeController {
  @Post('posts')
  @RequireVerifiedEmail()
  create() {
    return { ok: true };
  }
}

const PASSWORD = 'mat-khau-an-toan';

describe('TF05D: xác thực email và chặn spam đăng ký', () => {
  let app: INestApplication;
  let store: MemoryAccessStore;
  let limiter: MemoryActionRateLimiter;
  // Đồng hồ riêng của limiter: tua qua thời gian chờ xin mã và cửa sổ theo giờ.
  let limiterClockMs = Date.now();
  const advanceLimiter = (seconds: number) => {
    limiterClockMs += seconds * 1000;
  };
  const http = () => request(app.getHttpServer());
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    store = new MemoryAccessStore();
    limiter = new MemoryActionRateLimiter(() => limiterClockMs);
    const moduleRef = await Test.createTestingModule({
      imports: [
        FakePlatformModule,
        ClsModule.forRoot({ global: true, plugins: createNoOpTransactionalPlugins() }),
        AccessModule,
      ],
      controllers: [ProbeController],
    })
      .overrideProvider(ACCESS_STORE)
      .useValue(store)
      .overrideProvider(LOGIN_RATE_LIMITER)
      .useValue(new MemoryLoginRateLimiter())
      .overrideProvider(ACTION_RATE_LIMITER)
      .useValue(limiter)
      .overrideProvider(ACCESS_SID_BLOCKLIST)
      .useValue(new MemorySidBlocklist())
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    applyGlobalPrefix(app);
    await app.init();
  });

  // Mỗi test bắt đầu với hạn mức mới (theo IP, theo email), không phụ thuộc test chạy trước.
  beforeEach(() => advanceLimiter(REGISTER_WINDOW_SECONDS + 1));

  afterAll(async () => {
    await app.close();
  });

  /** Các sự kiện xác thực email của một người, theo thứ tự ghi. */
  const verificationEvents = (userId: string) =>
    store.outboxRows
      .filter((e) => e.type === 'access.email_verification_requested' && e.userId === userId)
      .map((e) => AccessEmailVerificationRequestedV1Schema.parse(e.payload));
  const tokenOf = (verifyUrl: string) => new URL(verifyUrl).searchParams.get('token')!;

  async function signUp(email: string) {
    const user = await seedLegacyAccount(app, { email, password: PASSWORD, displayName: 'Lan' });
    await app.get(EmailVerificationUseCases).issueInCurrentTransaction(user, 'signup', { ip: '127.0.0.1', userAgent: null });
    const login = await http().post('/api/auth/login').send({ email, password: PASSWORD }).expect(200);
    const events = verificationEvents(user.id);
    return {
      id: user.id,
      accessToken: login.body.accessToken as string,
      refreshToken: login.body.refreshToken as string,
      token: tokenOf(events.at(-1)!.verifyUrl),
    };
  }

  it('tài khoản cũ chưa xác thực: link 24 giờ và token chỉ lưu bản băm', async () => {
    const before = Date.now();
    const user = await signUp('moi@example.com');
    const events = verificationEvents(user.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      userId: user.id,
      email: 'moi@example.com',
      displayName: 'Lan',
      reason: 'signup',
    });
    expect(events[0]!.verifyUrl.startsWith(`${VERIFY_PAGE}?token=`)).toBe(true);
    const ttl = Date.parse(events[0]!.expiresAt) - before;
    expect(ttl).toBeGreaterThan(24 * 3600_000 - 60_000);
    expect(ttl).toBeLessThanOrEqual(24 * 3600_000 + 60_000);
    expect(JSON.stringify(store.emailVerificationRows)).not.toContain(user.token);
    expect(
      store.outboxRows.some((e) => e.type === 'access.user.welcome_email_requested' && e.userId === user.id),
    ).toBe(false);

    expect(decodeJwt(user.accessToken).ev).toBe(false);
    const me = await http().get('/api/auth/me').set(as(user.accessToken)).expect(200);
    expect(me.body.emailVerified).toBe(false);
  });

  it('yêu cầu mã chỉ gửi email, không tạo tài khoản hoặc cho đăng nhập', async () => {
    const email = 'otp-new@example.com';
    const credentials = { email, password: PASSWORD, displayName: 'Lan' };
    await http().post('/api/auth/register').send(credentials).expect(400);
    for (const password of ['huhuhuhu', 'Password123456', 'aaaaaaaaaaaa']) {
      const response = await http().post('/api/auth/registration-code').send({ email, password }).expect(400);
      expect(response.body.errors).toEqual([expect.objectContaining({ field: 'password' })]);
    }
    const first = await http().post('/api/auth/registration-code').send(credentials).expect(202);
    advanceLimiter(REGISTRATION_CODE_COOLDOWN_SECONDS);
    const second = await http().post('/api/auth/registration-code').send(credentials).expect(202);
    const messages = store.outboxRows.filter((event) => event.type === 'access.registration_code_requested' && event.payload.email === email);
    expect(messages).toHaveLength(2);
    const code = messages[1]!.payload.code as string;
    const payload = { ...credentials, registrationId: second.body.registrationId, code };
    const wrongCode = code === '00000000' ? '00000001' : '00000000';
    expect(store.registrationChallengeRows.get(email)?.codeHash).not.toContain(code);
    expect(await store.users.findByEmail(email)).toBeNull();
    await http().post('/api/auth/login').send(credentials).expect(401);
    await http().post('/api/auth/register').send({ ...payload, registrationId: first.body.registrationId }).expect(400);
    await http().post('/api/auth/register').send({ ...payload, code: wrongCode }).expect(400);
    await http().post('/api/auth/register').send({ ...payload, email: 'other@example.com' }).expect(400);
    expect(await store.users.findByEmail(email)).toBeNull();
    const reg = await http().post('/api/auth/register').send(payload).expect(201);
    expect(store.userRows.get(reg.body.id)?.emailVerifiedAt).toBeInstanceOf(Date);
    const login = await http().post('/api/auth/login').send(credentials).expect(200);
    expect(decodeJwt(login.body.accessToken).ev).toBe(true);
    await http().post('/api/auth/register').send(payload).expect(400);
  });

  it('xin mã bằng email đã có tài khoản: trả như email mới, không tạo mã, báo chủ email; tài khoản khoá thì không báo', async () => {
    const emails = ['ton-tai@example.com', 'ton-tai-google@example.com', 'ton-tai-khoa@example.com'];
    const existingEvents = (userId: string) =>
      store.outboxRows.filter((event) => event.type === 'access.registration_attempted_existing' && event.userId === userId);
    const withPassword = await signUp(emails[0]!);
    const googleOnly = await signUp(emails[1]!);
    store.userRows.get(googleOnly.id)!.passwordHash = null;
    const locked = await signUp(emails[2]!);
    store.userRows.get(locked.id)!.status = 'locked';

    for (const email of ['Ton-Tai@example.com', emails[1]!, emails[2]!]) {
      const response = await http().post('/api/auth/registration-code').send({ email, password: PASSWORD }).expect(202);
      expect(response.body).toEqual({ registrationId: expect.any(String), resendAfterSeconds: REGISTRATION_CODE_COOLDOWN_SECONDS });
      expect(store.registrationChallengeRows.has(email.toLowerCase())).toBe(false);
    }
    const codeEvents = store.outboxRows.filter(
      (event) => event.type === 'access.registration_code_requested' && emails.includes(event.payload.email as string),
    );
    expect(codeEvents).toHaveLength(0);
    expect(existingEvents(withPassword.id).map((event) => event.payload)).toEqual([
      { userId: withPassword.id, email: emails[0], displayName: 'Lan', hasPassword: true },
    ]);
    expect(existingEvents(googleOnly.id).map((event) => event.payload.hasPassword)).toEqual([false]);
    expect(existingEvents(locked.id)).toHaveLength(0);
  });

  it('xin mã lại trước 60 giây: 429 kèm retryAfterSeconds, như nhau dù email đã có tài khoản; hết thời gian chờ thì gửi được', async () => {
    const existing = 'cho-gui-lai-cu@example.com';
    await signUp(existing);
    for (const email of ['cho-gui-lai-moi@example.com', existing]) {
      await http().post('/api/auth/registration-code').send({ email, password: PASSWORD }).expect(202);
      advanceLimiter(REGISTRATION_CODE_COOLDOWN_SECONDS - 20);
      const tooSoon = await http().post('/api/auth/registration-code').send({ email, password: PASSWORD }).expect(429);
      expect(tooSoon.body).toMatchObject({ message: REGISTRATION_CODE_COOLDOWN_MESSAGE, retryAfterSeconds: 20 });
      expect(tooSoon.headers['retry-after']).toBe('20');
      advanceLimiter(20);
      await http().post('/api/auth/registration-code').send({ email, password: PASSWORD }).expect(202);
    }
    const codes = store.outboxRows.filter(
      (event) => event.type === 'access.registration_code_requested' && event.payload.email === 'cho-gui-lai-moi@example.com',
    );
    expect(codes).toHaveLength(2);
  });

  it('mã đăng ký hết hạn không tạo được tài khoản', async () => {
    const email = 'otp-expired@example.com';
    const credentials = { email, password: PASSWORD, displayName: 'Lan' };
    const requested = await http().post('/api/auth/registration-code').send(credentials).expect(202);
    const challenge = store.registrationChallengeRows.get(email)!;
    challenge.expiresAt = new Date(Date.now() - 1);
    const code = store.outboxRows.find((event) => event.type === 'access.registration_code_requested' && event.payload.email === email)!.payload.code;
    await http().post('/api/auth/register').send({ ...credentials, code, registrationId: requested.body.registrationId }).expect(400);
    expect(await store.users.findByEmail(email)).toBeNull();
  });

  it('chưa xác thực: API có @RequireVerifiedEmail trả 403 code email_unverified; chưa đăng nhập 401', async () => {
    const user = await signUp('chan@example.com');
    const res = await http().post('/api/v1/probe/posts').set(as(user.accessToken)).expect(403);
    expect(res.body).toMatchObject({ code: EMAIL_UNVERIFIED_CODE });
    await http().post('/api/v1/probe/posts').expect(401);
  });

  it('bấm link: 204, /auth/me thành đã xác thực; refresh nhận token ev=true và qua được @RequireVerifiedEmail', async () => {
    const user = await signUp('xac-thuc@example.com');
    await http().post('/api/auth/email/verify').send({ token: user.token }).expect(204);
    expect(store.userRows.get(user.id)?.emailVerifiedAt).toBeInstanceOf(Date);
    expect((await http().get('/api/auth/me').set(as(user.accessToken)).expect(200)).body.emailVerified).toBe(
      true,
    );

    // Token cũ vẫn mang ev=false tới khi hết hạn: client phải refresh.
    await http().post('/api/v1/probe/posts').set(as(user.accessToken)).expect(403);
    const refreshed = await http()
      .post('/api/auth/refresh')
      .send({ refreshToken: user.refreshToken })
      .expect(200);
    expect(decodeJwt(refreshed.body.accessToken).ev).toBe(true);
    await http().post('/api/v1/probe/posts').set(as(refreshed.body.accessToken)).expect(201);
    // Đăng nhập lại cũng có ev=true.
    const again = await http()
      .post('/api/auth/login')
      .send({ email: 'xac-thuc@example.com', password: PASSWORD })
      .expect(200);
    expect(decodeJwt(again.body.accessToken).ev).toBe(true);
    expect(store.auditRows.some((a) => a.action === 'auth.email_verified' && a.actorUserId === user.id)).toBe(
      true,
    );
  });

  it('link dùng lại, token rác, token hết hạn: 400 cùng một câu, không xác thực', async () => {
    const user = await signUp('dung-lai@example.com');
    await http().post('/api/auth/email/verify').send({ token: user.token }).expect(204);
    for (const token of [user.token, 'khong-hop-le', 'x'.repeat(43)]) {
      const res = await http().post('/api/auth/email/verify').send({ token }).expect(400);
      expect(res.body.message).toBe(INVALID_VERIFY_TOKEN_MESSAGE);
    }

    const late = await signUp('het-han@example.com');
    for (const row of store.emailVerificationRows.filter((r) => r.userId === late.id))
      row.expiresAt = new Date(Date.now() - 1000);
    expect(
      (await http().post('/api/auth/email/verify').send({ token: late.token }).expect(400)).body.message,
    ).toBe(INVALID_VERIFY_TOKEN_MESSAGE);
    expect(store.userRows.get(late.id)?.emailVerifiedAt).toBeNull();
  });

  it('tài khoản bị khoá sau khi nhận link: 400, không xác thực và không dùng mất link', async () => {
    const user = await signUp('bi-khoa@example.com');
    await store.users.updateStatus(user.id, 'locked');
    expect(
      (await http().post('/api/auth/email/verify').send({ token: user.token }).expect(400)).body.message,
    ).toBe(INVALID_VERIFY_TOKEN_MESSAGE);
    expect(store.userRows.get(user.id)?.emailVerifiedAt).toBeNull();
    expect(store.emailVerificationRows.find((row) => row.userId === user.id)?.usedAt).toBeNull();
  });

  it('gửi lại: sự kiện resend, link cũ hết dùng được, link mới dùng được; đã xác thực thì không gửi', async () => {
    const user = await signUp('gui-lai@example.com');
    const res = await http().post('/api/auth/email/verification').set(as(user.accessToken)).expect(200);
    expect(res.body).toMatchObject({ status: 'sent' });
    const events = verificationEvents(user.id);
    expect(events.map((e) => e.reason)).toEqual(['signup', 'resend']);
    expect(store.emailVerificationRows.filter((r) => r.userId === user.id && !r.usedAt)).toHaveLength(1);

    await http().post('/api/auth/email/verify').send({ token: user.token }).expect(400);
    await http()
      .post('/api/auth/email/verify')
      .send({ token: tokenOf(events[1]!.verifyUrl) })
      .expect(204);

    const done = await http().post('/api/auth/email/verification').set(as(user.accessToken)).expect(200);
    expect(done.body.status).toBe('already_verified');
    expect(verificationEvents(user.id)).toHaveLength(2);
    await http().post('/api/auth/email/verification').expect(401);
  });

  it('gửi lại quá 3 lần mỗi giờ: 429 kèm Retry-After, không có sự kiện mới', async () => {
    const user = await signUp('spam-gui-lai@example.com');
    for (let i = 0; i < 3; i += 1)
      await http().post('/api/auth/email/verification').set(as(user.accessToken)).expect(200);
    const blocked = await http().post('/api/auth/email/verification').set(as(user.accessToken)).expect(429);
    expect(blocked.body.message).toBe(TOO_MANY_RESENDS_MESSAGE);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    expect(verificationEvents(user.id)).toHaveLength(4); // signup + 3 lần gửi lại
  });

  it('đặt lại mật khẩu qua email cũng xác thực email (mở được hộp thư)', async () => {
    const user = await signUp('quen-mk@example.com');
    await http().post('/api/auth/password/forgot').send({ email: 'quen-mk@example.com' }).expect(202);
    const reset = store.outboxRows
      .filter((e) => e.type === 'access.password_reset_requested' && e.userId === user.id)
      .at(-1)!;
    const token = new URL((reset.payload as { resetUrl: string }).resetUrl).searchParams.get('token')!;
    await http()
      .post('/api/auth/password/reset')
      .send({ token, newPassword: 'mat-khau-moi-123' })
      .expect(204);
    expect(store.userRows.get(user.id)?.emailVerifiedAt).toBeInstanceOf(Date);
    const login = await http()
      .post('/api/auth/login')
      .send({ email: 'quen-mk@example.com', password: 'mat-khau-moi-123' })
      .expect(200);
    expect(decodeJwt(login.body.accessToken).ev).toBe(true);
  });

  it('đăng ký quá giới hạn theo IP mỗi giờ: 429 kèm Retry-After, không tạo tài khoản, không có email', async () => {
    // Các test trước đã đăng ký từ cùng IP; đăng ký tiếp tới khi chạm giới hạn.
    let created = 0;
    let blocked: request.Response | undefined;
    for (let i = 0; i < REGISTER_LIMIT + 1 && !blocked; i += 1) {
      const res = await http()
        .post('/api/auth/registration-code')
        .send({ email: `hang-loat-${i}@example.com`, password: PASSWORD, displayName: 'Bot' });
      if (res.status === 429) blocked = res;
      else {
        expect(res.status).toBe(202);
        created += 1;
      }
    }
    expect(blocked?.body.message).toBe(TOO_MANY_SIGNUPS_MESSAGE);
    expect(Number(blocked?.headers['retry-after'])).toBeGreaterThan(0);
    expect(created).toBeLessThanOrEqual(REGISTER_LIMIT);
    const blockedEmail = `hang-loat-${created}@example.com`;
    expect(store.registrationChallengeRows.has(blockedEmail)).toBe(false);
    // Đăng nhập không bị giới hạn đăng ký chặn.
    await http().post('/api/auth/login').send({ email: 'moi@example.com', password: PASSWORD }).expect(200);
  });
});
