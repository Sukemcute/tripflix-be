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
import { applyCors, applyGlobalPrefix } from '../../platform/http.js';
import { CORE_ENV, DB_POOLS, REDIS } from '../../platform/tokens.js';
import { AccessModule } from './access.module.js';
import { UNTRUSTED_ORIGIN_MESSAGE } from './auth/api/web-session.js';
import { ACCESS_SID_BLOCKLIST, ACCESS_STORE, LOGIN_RATE_LIMITER } from './auth/application/ports.js';
import { MemoryAccessStore } from './auth/infra/memory/memory-access.store.js';
import { MemoryLoginRateLimiter } from './auth/infra/memory/memory-login-rate-limiter.js';

const WEB_ORIGIN = 'http://localhost:3100';
const ADMIN_ORIGIN = 'http://localhost:3200';
const env = {
  NODE_ENV: 'test',
  AUTH_JWT_ISSUER: 'tripflix-core',
  AUTH_JWT_AUDIENCE: 'tripflix',
  AUTH_WEB_ORIGINS: [WEB_ORIGIN, ADMIN_ORIGIN],
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
const WEB = { 'X-Tripflix-Client': 'web', Origin: WEB_ORIGIN };

/** Lấy giá trị cookie tripflix_refresh và các thuộc tính từ Set-Cookie. */
function readSetCookie(res: request.Response) {
  const raw = ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith('tripflix_refresh='));
  if (!raw) return undefined;
  const [pair, ...attrs] = raw.split(';').map((p) => p.trim());
  return { value: pair!.slice('tripflix_refresh='.length), attrs: attrs.map((a) => a.toLowerCase()), raw };
}

describe('TF056: refresh token trong cookie cho web, admin', () => {
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
      .overrideProvider(ACTION_RATE_LIMITER)
      .useValue(new MemoryActionRateLimiter())
      .overrideProvider(LOGIN_RATE_LIMITER)
      .useValue(new MemoryLoginRateLimiter())
      .overrideProvider(ACCESS_SID_BLOCKLIST)
      .useValue(new MemorySidBlocklist())
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    applyGlobalPrefix(app);
    applyCors(app, env.AUTH_WEB_ORIGINS);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  async function register(email: string) {
    await registerTestAccount(app, { email, password: PASSWORD, displayName: 'Web' });
  }

  async function webLogin(email: string) {
    const res = await http().post('/api/auth/login').set(WEB).send({ email, password: PASSWORD }).expect(200);
    return { res, cookie: readSetCookie(res)! };
  }

  it('đăng nhập web: cookie HttpOnly, SameSite=Lax, Path=/api/auth, 30 ngày; body không có refreshToken', async () => {
    await register('web-login@example.com');
    const { res, cookie } = await webLogin('web-login@example.com');

    expect(res.body).toMatchObject({ tokenType: 'Bearer', expiresIn: 900 });
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body).not.toHaveProperty('refreshToken');
    expect(cookie.value.length).toBeGreaterThan(20);
    expect(cookie.attrs).toEqual(expect.arrayContaining(['httponly', 'samesite=lax', 'path=/api/auth', 'max-age=2592000']));
    // Môi trường test chạy http: không bật Secure (production bật, xem web-session.spec.ts).
    expect(cookie.attrs).not.toContain('secure');
  });

  it('đăng nhập web với Origin lạ hoặc thiếu Origin: 403, không tạo phiên', async () => {
    await register('web-evil@example.com');
    const before = store.sessionRows.size;
    const evil = await http()
      .post('/api/auth/login')
      .set({ 'X-Tripflix-Client': 'web', Origin: 'https://evil.example' })
      .send({ email: 'web-evil@example.com', password: PASSWORD })
      .expect(403);
    expect(evil.body.message).toBe(UNTRUSTED_ORIGIN_MESSAGE);
    await http()
      .post('/api/auth/login')
      .set({ 'X-Tripflix-Client': 'web' })
      .send({ email: 'web-evil@example.com', password: PASSWORD })
      .expect(403);
    expect(store.sessionRows.size).toBe(before);
  });

  it('làm mới bằng cookie (body trống): nhận cookie mới, body không có refreshToken; admin cũng dùng được', async () => {
    await register('web-refresh@example.com');
    const { cookie } = await webLogin('web-refresh@example.com');

    const res = await http().post('/api/auth/refresh').set(WEB).set('Cookie', `tripflix_refresh=${cookie.value}`).expect(200);
    const next = readSetCookie(res)!;
    expect(res.body).not.toHaveProperty('refreshToken');
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(next.value).not.toBe(cookie.value);

    // Admin cũng là origin tin cậy; chỉ có cookie, không gửi header web vẫn được coi là chế độ web.
    const admin = await http()
      .post('/api/auth/refresh')
      .set({ Origin: ADMIN_ORIGIN, Cookie: `tripflix_refresh=${next.value}` })
      .expect(200);
    expect(admin.body).not.toHaveProperty('refreshToken');
    expect(readSetCookie(admin)).toBeDefined();
  });

  it('CSRF: trang lạ khiến trình duyệt gửi cookie thì nhận 403, cookie vẫn dùng được từ web thật', async () => {
    await register('web-csrf@example.com');
    const { cookie } = await webLogin('web-csrf@example.com');

    const evil = await http()
      .post('/api/auth/refresh')
      .set({ Origin: 'https://evil.example', Cookie: `tripflix_refresh=${cookie.value}` })
      .expect(403);
    expect(readSetCookie(evil)).toBeUndefined();
    await http().post('/api/auth/refresh').set({ Cookie: `tripflix_refresh=${cookie.value}` }).expect(403);

    await http().post('/api/auth/refresh').set(WEB).set('Cookie', `tripflix_refresh=${cookie.value}`).expect(200);
  });

  it('làm mới web lỗi (không có cookie, cookie hỏng): 401 và xoá cookie', async () => {
    const none = await http().post('/api/auth/refresh').set(WEB).expect(401);
    expect(readSetCookie(none)?.raw).toMatch(/Expires=Thu, 01 Jan 1970/);

    const broken = await http().post('/api/auth/refresh').set(WEB).set('Cookie', 'tripflix_refresh=khong-hop-le').expect(401);
    expect(readSetCookie(broken)?.raw).toMatch(/Expires=Thu, 01 Jan 1970/);
  });

  it('đăng xuất web xoá cookie; cookie cũ gửi lại nhận 401', async () => {
    await register('web-logout@example.com');
    const { res, cookie } = await webLogin('web-logout@example.com');

    const out = await http()
      .post('/api/auth/logout')
      .set(WEB)
      .set({ Authorization: `Bearer ${res.body.accessToken}`, Cookie: `tripflix_refresh=${cookie.value}` })
      .expect(204);
    expect(readSetCookie(out)).toMatchObject({ value: '' });
    await http().post('/api/auth/refresh').set(WEB).set('Cookie', `tripflix_refresh=${cookie.value}`).expect(401);
  });

  it('logout-all từ web cũng xoá cookie', async () => {
    await register('web-all@example.com');
    const { res, cookie } = await webLogin('web-all@example.com');
    const out = await http()
      .post('/api/auth/logout-all')
      .set(WEB)
      .set({ Authorization: `Bearer ${res.body.accessToken}`, Cookie: `tripflix_refresh=${cookie.value}` })
      .expect(204);
    expect(readSetCookie(out)).toMatchObject({ value: '' });
  });

  it('app mobile không đổi: refreshToken trong body, không có Set-Cookie, không cần Origin', async () => {
    await register('mobile@example.com');
    const login = await http().post('/api/auth/login').send({ email: 'mobile@example.com', password: PASSWORD }).expect(200);
    expect(login.body.refreshToken).toEqual(expect.any(String));
    expect(login.headers['set-cookie']).toBeUndefined();

    const refreshed = await http().post('/api/auth/refresh').send({ refreshToken: login.body.refreshToken }).expect(200);
    expect(refreshed.body.refreshToken).toEqual(expect.any(String));
    expect(refreshed.headers['set-cookie']).toBeUndefined();

    // Không gửi token nào: 401 như token sai.
    await http().post('/api/auth/refresh').send({}).expect(401);
  });

  it('CORS: origin tin cậy được phép kèm cookie; origin lạ không có Access-Control-Allow-Origin', async () => {
    const ok = await http()
      .options('/api/auth/refresh')
      .set({ Origin: WEB_ORIGIN, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'x-tripflix-client,content-type' })
      .expect(204);
    expect(ok.headers['access-control-allow-origin']).toBe(WEB_ORIGIN);
    expect(ok.headers['access-control-allow-credentials']).toBe('true');
    expect(ok.headers['access-control-allow-headers']).toMatch(/x-tripflix-client/);

    const evil = await http()
      .options('/api/auth/refresh')
      .set({ Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' });
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
  });
});
