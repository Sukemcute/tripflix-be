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
import { ACCESS_SID_BLOCKLIST, ACCESS_STORE, LOGIN_RATE_LIMITER } from './auth/application/ports.js';
import { GOOGLE_LOGIN_FAILED_MESSAGE, INVALID_CREDENTIALS_MESSAGE } from './auth/domain/credentials.js';
import { MemoryAccessStore } from './auth/infra/memory/memory-access.store.js';
import { MemoryLoginRateLimiter } from './auth/infra/memory/memory-login-rate-limiter.js';

const WEB_CLIENT_ID = 'tripflix-web.apps.googleusercontent.com';
const ANDROID_CLIENT_ID = 'tripflix-android.apps.googleusercontent.com';
const KID = 'google-fake-1';
const PASSWORD = 'mat-khau-an-toan';

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

  it('trùng email với tài khoản mật khẩu: liên kết vào tài khoản đó, mật khẩu vẫn dùng được', async () => {
    const reg = await http().post('/api/auth/register').send({ email: 'co-mat-khau@example.com', password: PASSWORD, displayName: 'An' }).expect(201);
    const res = await google(await googleToken({ sub: 'sub-linked', email: 'co-mat-khau@example.com' })).expect(200);
    expect(decodeJwt(res.body.accessToken).sub).toBe(reg.body.id);
    expect(store.identityRows.some((i) => i.subject === 'sub-linked' && i.userId === reg.body.id)).toBe(true);
    expect(store.userRows.get(reg.body.id)?.displayName).toBe('An');
    await http().post('/api/auth/login').send({ email: 'co-mat-khau@example.com', password: PASSWORD }).expect(200);
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
    const reg = await http().post('/api/auth/register').send({ email: 'bi-khoa@example.com', password: PASSWORD, displayName: 'K' }).expect(201);
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
    const reg = await http()
      .post('/api/auth/register')
      .set('X-Anon-Id', anonRegister)
      .send({ email: 'khach@example.com', password: PASSWORD, displayName: 'Khách' })
      .expect(201);
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

  it('chế độ web: cookie HttpOnly, body không có refreshToken; Origin lạ 403', async () => {
    const token = await googleToken({ sub: 'sub-web', email: 'web-google@gmail.com' });
    const res = await google(token, { 'X-Tripflix-Client': 'web', Origin: 'http://localhost:3100' }).expect(200);
    expect(res.body).not.toHaveProperty('refreshToken');
    expect(String(res.headers['set-cookie'])).toMatch(/tripflix_refresh=.+HttpOnly/);
    await google(token, { 'X-Tripflix-Client': 'web', Origin: 'https://evil.example' }).expect(403);
  });
});
