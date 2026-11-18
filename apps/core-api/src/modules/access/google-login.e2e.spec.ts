import { ACTION_RATE_LIMITER, MemoryActionRateLimiter } from './index.js';
import { registerTestAccount, seedLegacyAccount } from '../../platform/registration.fixture.js';
import 'reflect-metadata';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Global, type INestApplication, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MemorySidBlocklist } from '@tripflix/auth';
import { createNoOpTransactionalPlugins } from '@tripflix/db';
import { SignJWT, decodeJwt, exportJWK, generateKeyPair, type CryptoKey, type JWTPayload } from 'jose';
import { ClsModule } from 'nestjs-cls';
import request from 'supertest';
import type { CoreEnv } from '../../platform/env.js';
import { applyGlobalPrefix } from '../../platform/http.js';
import { CORE_ENV, DB_POOLS, REDIS } from '../../platform/tokens.js';
import { AccessModule } from './access.module.js';
import { ACCESS_SID_BLOCKLIST, ACCESS_STORE, AVATAR_IMAGES, LOGIN_RATE_LIMITER, PASSWORD_HASHER, type AvatarImages } from './auth/application/ports.js';
import { createTestPasswordHasher } from './auth/infra/test-password-hasher.js';
import { GOOGLE_LOGIN_FAILED_MESSAGE, INVALID_CREDENTIALS_MESSAGE } from './auth/domain/credentials.js';
import { MemoryAccessStore } from './auth/infra/memory/memory-access.store.js';
import { MemoryLoginRateLimiter } from './auth/infra/memory/memory-login-rate-limiter.js';

const WEB_CLIENT_ID = 'tripflix-web.apps.googleusercontent.com';
const ANDROID_CLIENT_ID = 'tripflix-android.apps.googleusercontent.com';
const KID = 'google-fake-1';
const PASSWORD = 'mat-khau-an-toan';
const GOOGLE_PHOTO = 'https://lh3.googleusercontent.com/a/anh-google';
const UPLOADED_MEDIA_ID = '11111111-1111-4111-8111-111111111111';
const UPLOADED_URL = 'https://cdn.example.com/media/anh-tu-tai.jpg';

describe('TF059: đăng nhập Google và gộp gu khách X-Anon-Id', () => {
  let app: INestApplication;
  let store: MemoryAccessStore;
  let jwksServer: Server;
  let googleKey: CryptoKey;
  let otherKey: CryptoKey;
  const http = () => request(app.getHttpServer());

  /** Ký token giống Google Sign-In; override để làm token sai. */
  async function googleToken(claims: JWTPayload = {}, options: { key?: CryptoKey; expiresIn?: string | number } = {}) {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({ email_verified: true, name: 'Khang Nguyễn', ...claims })
      .setProtectedHeader({ alg: 'RS256', kid: KID, typ: 'JWT' })
      .setIssuer((claims.iss as string | undefined) ?? 'https://accounts.google.com')
      .setAudience((claims.aud as string | undefined) ?? WEB_CLIENT_ID)
      .setSubject((claims.sub as string | undefined) ?? 'google-sub-1')
      .setIssuedAt(now - 10)
      .setExpirationTime(options.expiresIn ?? now + 3600)
      .sign(options.key ?? googleKey);
  }

  const google = (idToken: string, headers: Record<string, string> = {}) =>
    http().post('/api/auth/google').set(headers).send({ idToken, deviceName: 'Pixel 8' });
  const guestMerged = (anonId: string) =>
    store.outboxRows.filter((e) => e.type === 'access.user.guest_merged' && e.payload.anonId === anonId);

  beforeAll(async () => {
    const pair = await generateKeyPair('RS256');
    googleKey = pair.privateKey;
    ({ privateKey: otherKey } = await generateKeyPair('RS256'));
    const publicJwk = await exportJWK(pair.publicKey);
    // Server JWKS giả thay cho https://www.googleapis.com/oauth2/v3/certs.
    jwksServer = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ keys: [{ ...publicJwk, kid: KID, alg: 'RS256', use: 'sig' }] }));
    });
    await new Promise<void>((resolve) => jwksServer.listen(0, '127.0.0.1', resolve));
    const { port } = jwksServer.address() as AddressInfo;

    const env = {
      NODE_ENV: 'test',
      AUTH_JWT_ISSUER: 'tripflix-core',
      AUTH_JWT_AUDIENCE: 'tripflix',
      AUTH_WEB_ORIGINS: ['http://localhost:3100'],
      GOOGLE_CLIENT_IDS: [WEB_CLIENT_ID, ANDROID_CLIENT_ID],
      GOOGLE_JWKS_URL: `http://127.0.0.1:${port}/oauth2/v3/certs`,
    } as unknown as CoreEnv;

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

    store = new MemoryAccessStore();
    const moduleRef = await Test.createTestingModule({
      imports: [FakePlatformModule, ClsModule.forRoot({ global: true, plugins: createNoOpTransactionalPlugins() }), AccessModule],
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
      // Ảnh đã tải xong của đúng chủ thì nhận; id khác coi như của người khác hay chưa xong.
      .overrideProvider(AVATAR_IMAGES)
      .useValue({
        findOwnedImageUrl: async (_ownerId, mediaId) => (mediaId === UPLOADED_MEDIA_ID ? UPLOADED_URL : null),
      } satisfies AvatarImages)
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    applyGlobalPrefix(app);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await new Promise((resolve) => jwksServer?.close(resolve));
  });

  it('lần đầu tạo member không có mật khẩu, lần sau vào đúng tài khoản đó', async () => {
    const token = await googleToken({ sub: 'sub-new', email: 'Moi@Gmail.com' });
    const first = await google(token).expect(200);
    const claims = decodeJwt(first.body.accessToken);
    expect(claims.role).toBe('member');
    const user = store.userRows.get(claims.sub!)!;
    expect(user).toMatchObject({ email: 'moi@gmail.com', displayName: 'Khang Nguyễn', passwordHash: null, role: 'member' });
    expect(store.identityRows).toContainEqual({ provider: 'google', subject: 'sub-new', userId: user.id, email: 'moi@gmail.com' });
    expect(store.outboxRows.filter((e) => e.type === 'access.user.registered' && e.userId === user.id)).toHaveLength(1);

    // Token của app Android (aud khác, cùng người) vào đúng tài khoản, không tạo thêm.
    const usersBefore = store.userRows.size;
    const again = await google(await googleToken({ sub: 'sub-new', email: 'moi@gmail.com', aud: ANDROID_CLIENT_ID })).expect(200);
    expect(decodeJwt(again.body.accessToken).sub).toBe(user.id);
    expect(store.userRows.size).toBe(usersBefore);
    await http().get('/api/auth/me').set('Authorization', `Bearer ${again.body.accessToken}`).expect(200);
  });

  it('trùng email với tài khoản mật khẩu ĐÃ xác thực: liên kết vào tài khoản đó, mật khẩu vẫn dùng được', async () => {
    const reg = await registerTestAccount(app, { email: 'co-mat-khau@example.com', password: PASSWORD, displayName: 'An' });
    await store.users.markEmailVerified(reg.body.id, new Date());
    const res = await google(await googleToken({ sub: 'sub-linked', email: 'co-mat-khau@example.com' })).expect(200);
    expect(decodeJwt(res.body.accessToken)).toMatchObject({ sub: reg.body.id, ev: true });
    expect(store.identityRows.some((i) => i.subject === 'sub-linked' && i.userId === reg.body.id)).toBe(true);
    expect(store.userRows.get(reg.body.id)?.displayName).toBe('An');
    await http().post('/api/auth/login').send({ email: 'co-mat-khau@example.com', password: PASSWORD }).expect(200);
  });

  it('TF05D: trùng email với tài khoản mật khẩu CHƯA xác thực: liên kết, xoá mật khẩu và phiên cũ (chống chiếm tài khoản trước)', async () => {
    // Kẻ xấu đăng ký trước bằng email của chủ thật rồi đăng nhập giữ phiên.
    const reg = await seedLegacyAccount(app, { email: 'bi-chiem@example.com', password: PASSWORD, displayName: 'Kẻ xấu' });
    const attacker = await http().post('/api/auth/login').send({ email: 'bi-chiem@example.com', password: PASSWORD }).expect(200);
    // Chủ thật đăng nhập Google: Google chứng minh họ sở hữu email.
    const res = await google(await googleToken({ sub: 'sub-chu-that', email: 'bi-chiem@example.com' })).expect(200);
    expect(decodeJwt(res.body.accessToken)).toMatchObject({ sub: reg.id, ev: true });
    expect(store.userRows.get(reg.id)).toMatchObject({ passwordHash: null });
    expect(store.userRows.get(reg.id)?.emailVerifiedAt).toBeInstanceOf(Date);
    // Mật khẩu kẻ xấu đặt hết dùng được, phiên của kẻ xấu bị thu hồi ngay.
    await http().post('/api/auth/login').send({ email: 'bi-chiem@example.com', password: PASSWORD }).expect(401);
    await http().get('/api/auth/me').set('Authorization', `Bearer ${attacker.body.accessToken}`).expect(401);
    await http().post('/api/auth/refresh').send({ refreshToken: attacker.body.refreshToken }).expect(401);
    const audit = store.auditRows.find((a) => a.action === 'auth.google_linked' && a.actorUserId === reg.id);
    expect(audit?.meta).toMatchObject({ clearedUnverifiedPassword: true, revokedSessions: 1 });
  });

  it('token sai aud, sai iss, hết hạn, sai chữ ký, email chưa xác minh: 401 cùng một câu', async () => {
    const now = Math.floor(Date.now() / 1000);
    const bad = [
      await googleToken({ aud: 'app-khac.apps.googleusercontent.com' }),
      await googleToken({ iss: 'https://evil.example' }),
      await googleToken({}, { expiresIn: now - 60 }),
      await googleToken({}, { key: otherKey }),
      await googleToken({ email: 'chua-xac-minh@gmail.com', email_verified: false }),
      'khong-phai-jwt',
    ];
    for (const token of bad) {
      const res = await google(token).expect(401);
      expect(res.body.message).toBe(GOOGLE_LOGIN_FAILED_MESSAGE);
    }
    expect(store.userRows.size).toBeGreaterThan(0);
    expect([...store.userRows.values()].some((u) => u.email === 'chua-xac-minh@gmail.com')).toBe(false);
  });

  it('tài khoản bị khoá: 401, không liên kết thêm', async () => {
    const reg = await registerTestAccount(app, { email: 'bi-khoa@example.com', password: PASSWORD, displayName: 'K' });
    store.userRows.set(reg.body.id, { ...store.userRows.get(reg.body.id)!, status: 'locked' });
    await google(await googleToken({ sub: 'sub-locked', email: 'bi-khoa@example.com' })).expect(401);
    expect(store.identityRows.some((i) => i.subject === 'sub-locked')).toBe(false);
  });

  it('tài khoản chỉ có Google: đăng nhập bằng mật khẩu nhận lỗi chung, đổi mật khẩu nhận 400', async () => {
    const res = await google(await googleToken({ sub: 'sub-only', email: 'chi-google@gmail.com' })).expect(200);
    const login = await http().post('/api/auth/login').send({ email: 'chi-google@gmail.com', password: 'bat-ky-mat-khau' }).expect(401);
    expect(login.body.message).toBe(INVALID_CREDENTIALS_MESSAGE);
    await http()
      .post('/api/auth/password/change')
      .set('Authorization', `Bearer ${res.body.accessToken}`)
      .send({ currentPassword: 'bat-ky-mat-khau', newPassword: 'mat-khau-moi-123' })
      .expect(400);
  });

  it('X-Anon-Id: đúng một access.user.guest_merged mỗi lần đăng ký, đăng nhập, đăng nhập Google', async () => {
    const anonRegister = '6f1c1c55-8a1e-4c0b-9e43-2b1a7a8f0a01';
    const reg = await registerTestAccount(app, { email: 'khach@example.com', password: PASSWORD, displayName: 'Khách' }, 201, { 'X-Anon-Id': anonRegister });
    expect(guestMerged(anonRegister).map((e) => e.payload)).toEqual([{ anonId: anonRegister, userId: reg.body.id }]);

    const anonLogin = '6f1c1c55-8a1e-4c0b-9e43-2b1a7a8f0a02';
    await http().post('/api/auth/login').set('X-Anon-Id', anonLogin).send({ email: 'khach@example.com', password: PASSWORD }).expect(200);
    expect(guestMerged(anonLogin).map((e) => e.payload)).toEqual([{ anonId: anonLogin, userId: reg.body.id }]);

    // Đăng nhập Google lần đầu (tạo tài khoản + mở phiên) vẫn chỉ một sự kiện.
    const anonGoogle = '6F1C1C55-8A1E-4C0B-9E43-2B1A7A8F0A03';
    const g = await google(await googleToken({ sub: 'sub-guest', email: 'khach-google@gmail.com' }), { 'X-Anon-Id': anonGoogle }).expect(200);
    expect(guestMerged(anonGoogle.toLowerCase()).map((e) => e.payload)).toEqual([
      { anonId: anonGoogle.toLowerCase(), userId: decodeJwt(g.body.accessToken).sub },
    ]);
  });

  it('X-Anon-Id sai dạng hoặc đăng nhập lỗi: không có sự kiện', async () => {
    const before = store.outboxRows.filter((e) => e.type === 'access.user.guest_merged').length;
    await http().post('/api/auth/login').set('X-Anon-Id', 'khong-phai-uuid').send({ email: 'khach@example.com', password: PASSWORD }).expect(200);
    await http()
      .post('/api/auth/login')
      .set('X-Anon-Id', '6f1c1c55-8a1e-4c0b-9e43-2b1a7a8f0a09')
      .send({ email: 'khach@example.com', password: 'sai-mat-khau' })
      .expect(401);
    await google('khong-phai-jwt', { 'X-Anon-Id': '6f1c1c55-8a1e-4c0b-9e43-2b1a7a8f0a10' }).expect(401);
    expect(store.outboxRows.filter((e) => e.type === 'access.user.guest_merged').length).toBe(before);
  });

  it('email chào mừng: đúng 1 sự kiện khi tạo tài khoản (mật khẩu, Google), không gửi khi đăng nhập lại, liên kết hay đăng ký trùng', async () => {
    const welcome = (userId: string) =>
      store.outboxRows.filter((e) => e.type === 'access.user.welcome_email_requested' && e.userId === userId);

    const reg = await registerTestAccount(app, { email: 'chao@example.com', password: PASSWORD, displayName: 'Chào' });
    expect(welcome(reg.body.id)).toHaveLength(1);
    await store.users.markEmailVerified(reg.body.id, new Date());
    await registerTestAccount(app, { email: 'chao@example.com', password: PASSWORD, displayName: 'Trùng' }, 409);
    await http().post('/api/auth/login').send({ email: 'chao@example.com', password: PASSWORD }).expect(200);
    // Liên kết Google vào tài khoản có sẵn: không phải tài khoản mới, không chào lại.
    await google(await googleToken({ sub: 'sub-chao-link', email: 'chao@example.com' })).expect(200);
    expect(welcome(reg.body.id)).toHaveLength(1);

    const first = await google(await googleToken({ sub: 'sub-chao-google', email: 'moi-chao@gmail.com', name: 'Google Mới' })).expect(200);
    const googleUserId = decodeJwt(first.body.accessToken).sub!;
    expect(welcome(googleUserId).map((e) => e.payload)).toEqual([
      { userId: googleUserId, email: 'moi-chao@gmail.com', displayName: 'Google Mới', provider: 'google' },
    ]);
    await google(await googleToken({ sub: 'sub-chao-google', email: 'moi-chao@gmail.com' })).expect(200);
    expect(welcome(googleUserId)).toHaveLength(1);
  });

  it('chế độ web: cookie HttpOnly, body không có refreshToken; Origin lạ 403', async () => {
    const token = await googleToken({ sub: 'sub-web', email: 'web-google@gmail.com' });
    const { createTestBrowserProof } = await import('./auth/infra/test-browser-proof.js');
    const proof = await createTestBrowserProof();
    const origin = 'http://localhost:3100';
    const res = await google(token, { 'X-Tripflix-Client': 'web', Origin: origin, ...await proof('google', origin) }).expect(200);
    expect(res.body).not.toHaveProperty('refreshToken');
    expect(String(res.headers['set-cookie'])).toMatch(/tripflix_refresh=.+HttpOnly/);
    await google(token, { 'X-Tripflix-Client': 'web', Origin: 'https://evil.example' }).expect(403);
  });

  describe('TF109: ảnh đại diện', () => {
    const profileEvents = (userId: string) =>
      store.outboxRows.filter((e) => e.type === 'access.user.profile_updated' && e.userId === userId).map((e) => e.payload);
    const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

    it('Google lần đầu: lấy picture làm ảnh, sự kiện registered mang ảnh; đổi ảnh Google thì lần sau cập nhật', async () => {
      const first = await google(await googleToken({ sub: 'sub-anh', email: 'anh@gmail.com', picture: GOOGLE_PHOTO })).expect(200);
      const userId = decodeJwt(first.body.accessToken).sub!;
      const me = await http().get('/api/auth/me').set(bearer(first.body.accessToken)).expect(200);
      expect(me.body.avatarUrl).toBe(GOOGLE_PHOTO);
      expect(store.outboxRows.find((e) => e.type === 'access.user.registered' && e.userId === userId)?.payload).toMatchObject({ avatarUrl: GOOGLE_PHOTO });

      await google(await googleToken({ sub: 'sub-anh', email: 'anh@gmail.com', picture: `${GOOGLE_PHOTO}-moi` })).expect(200);
      expect(store.userRows.get(userId)).toMatchObject({ avatarUrl: `${GOOGLE_PHOTO}-moi`, avatarSource: 'google' });
      expect(profileEvents(userId)).toEqual([{ userId, displayName: 'Khang Nguyễn', avatarUrl: `${GOOGLE_PHOTO}-moi` }]);
      await http().get(`/api/v1/users/${userId}/avatar`).expect(302).expect('Location', `${GOOGLE_PHOTO}-moi`);
    });

    it('tự tải ảnh rồi đăng nhập Google: không bị ghi đè; xoá ảnh thì Google cũng không gắn lại', async () => {
      const first = await google(await googleToken({ sub: 'sub-tu-tai', email: 'tu-tai@gmail.com', picture: GOOGLE_PHOTO })).expect(200);
      const userId = decodeJwt(first.body.accessToken).sub!;

      const set = await http().put('/api/auth/me/avatar').set(bearer(first.body.accessToken)).send({ mediaId: UPLOADED_MEDIA_ID }).expect(200);
      expect(set.body.avatarUrl).toBe(UPLOADED_URL);
      await google(await googleToken({ sub: 'sub-tu-tai', email: 'tu-tai@gmail.com', picture: `${GOOGLE_PHOTO}-khac` })).expect(200);
      expect(store.userRows.get(userId)).toMatchObject({ avatarUrl: UPLOADED_URL, avatarSource: 'upload' });

      const removed = await http().delete('/api/auth/me/avatar').set(bearer(first.body.accessToken)).expect(200);
      expect(removed.body.avatarUrl).toBeNull();
      await google(await googleToken({ sub: 'sub-tu-tai', email: 'tu-tai@gmail.com', picture: GOOGLE_PHOTO })).expect(200);
      expect(store.userRows.get(userId)).toMatchObject({ avatarUrl: null, avatarSource: 'none' });
      expect(profileEvents(userId).map((e) => e.avatarUrl)).toEqual([UPLOADED_URL, null]);
      await http().get(`/api/v1/users/${userId}/avatar`).expect(404);
    });

    it('ảnh không phải của mình hoặc chưa tải xong: 400; mediaId sai dạng: 400; chưa đăng nhập: 401', async () => {
      const res = await google(await googleToken({ sub: 'sub-sai-anh', email: 'sai-anh@gmail.com' })).expect(200);
      await http().put('/api/auth/me/avatar').set(bearer(res.body.accessToken)).send({ mediaId: '22222222-2222-4222-8222-222222222222' }).expect(400);
      await http().put('/api/auth/me/avatar').set(bearer(res.body.accessToken)).send({ mediaId: 'khong-phai-uuid' }).expect(400);
      await http().put('/api/auth/me/avatar').send({ mediaId: UPLOADED_MEDIA_ID }).expect(401);
      expect(store.userRows.get(decodeJwt(res.body.accessToken).sub!)?.avatarUrl).toBeNull();
    });
  });
});
