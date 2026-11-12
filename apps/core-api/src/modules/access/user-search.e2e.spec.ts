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
import { ACCESS_SID_BLOCKLIST, ACCESS_STORE, ACTION_RATE_LIMITER, LOGIN_RATE_LIMITER, PASSWORD_HASHER } from './auth/application/ports.js';
import { MemoryAccessStore } from './auth/infra/memory/memory-access.store.js';
import { MemoryActionRateLimiter } from './auth/infra/memory/memory-action-rate-limiter.js';
import { MemoryLoginRateLimiter } from './auth/infra/memory/memory-login-rate-limiter.js';
import { createTestPasswordHasher } from './auth/infra/test-password-hasher.js';

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

describe('TF10: tìm người dùng công khai GET /api/v1/users/search', () => {
  let app: INestApplication;
  let store: MemoryAccessStore;
  // Mỗi test một IP riêng (qua X-Forwarded-For, như sau Traefik) để giới hạn theo IP không dính sang test khác.
  let clientIp = '';
  let ipCounter = 0;
  const search = (query: Record<string, string | number>, ip = clientIp) =>
    request(app.getHttpServer()).get('/api/v1/users/search').set('X-Forwarded-For', ip).query(query);

  async function addUser(
    email: string,
    displayName: string,
    role: 'member' | 'moderator' | 'superadmin' = 'member',
    verified = true,
  ) {
    const user = await store.users.insert({ email, passwordHash: null, displayName, role });
    if (verified) await store.users.markEmailVerified(user!.id, new Date());
    return user!.id;
  }

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
      .overrideProvider(PASSWORD_HASHER)
      .useValue(createTestPasswordHasher())
      .overrideProvider(LOGIN_RATE_LIMITER)
      .useValue(new MemoryLoginRateLimiter())
      .overrideProvider(ACCESS_SID_BLOCKLIST)
      .useValue(new MemorySidBlocklist())
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    (app.getHttpAdapter().getInstance() as { set(key: string, value: unknown): void }).set('trust proxy', 1);
    applyGlobalPrefix(app);
    await app.init();
  });

  beforeEach(() => {
    ipCounter += 1;
    clientIp = `203.0.113.${ipCounter}`;
  });

  afterAll(async () => {
    await app.close();
  });

  it('không cần đăng nhập, "bao" khớp "Bảo", chỉ trả id và tên hiển thị', async () => {
    const id = await addUser('bao-le@example.com', 'Lê Bảo');
    const res = await search({ q: 'BAO' }).expect(200);
    expect(res.body).toEqual({ items: [{ id, displayName: 'Lê Bảo' }], page: 1, hasMore: false });
    expect(Object.keys(res.body.items[0]).sort()).toEqual(['displayName', 'id']);
    expect((await search({ q: 'lê bảo' }).expect(200)).body.items).toEqual([{ id, displayName: 'Lê Bảo' }]);
  });

  it('không cho cache, không đặt cookie, bỏ qua cookie gửi kèm', async () => {
    await addUser('cookie@example.com', 'Cookie Test');
    const plain = await search({ q: 'cookie' }).expect(200);
    expect(plain.headers['cache-control']).toBe('no-store');
    expect(plain.headers['x-content-type-options']).toBe('nosniff');
    expect(plain.headers['content-type']).toMatch(/^application\/json/);
    expect(plain.headers['set-cookie']).toBeUndefined();
    const withCookie = await search({ q: 'cookie' }).set('Cookie', 'tf_refresh=abc; tf_session=xyz').expect(200);
    expect(withCookie.body).toEqual(plain.body);
    expect(withCookie.headers['set-cookie']).toBeUndefined();
  });

  it('không khớp email', async () => {
    await addUser('emailonly-xyz@example.com', 'Người Thứ Hai');
    expect((await search({ q: 'emailonly' }).expect(200)).body.items).toEqual([]);
  });

  it('ẩn tài khoản bị khoá', async () => {
    const id = await addUser('khoa@example.com', 'Đăng Khoá');
    expect((await search({ q: 'dang khoa' }).expect(200)).body.items).toHaveLength(1);
    await store.users.updateStatus(id, 'locked');
    expect((await search({ q: 'dang khoa' }).expect(200)).body.items).toEqual([]);
  });

  it('ẩn thành viên chưa xác thực email và thành viên dưới độ tuổi tìm kiếm', async () => {
    await addUser('unverified@example.com', 'Tìm Mẫu Chưa Xác Thực', 'member', false);
    const child = await addUser('young@example.com', 'Tìm Mẫu Trẻ');
    await store.users.updateProfile(child, { dateOfBirth: '2020-01-01' });
    const adult = await addUser('adult@example.com', 'Tìm Mẫu Người Lớn');
    await store.users.updateProfile(adult, { dateOfBirth: '1990-01-01' });
    expect((await search({ q: 'tim mau' }).expect(200)).body.items).toEqual([
      { id: adult, displayName: 'Tìm Mẫu Người Lớn' },
    ]);
  });

  it('ẩn nhân viên (kiểm duyệt viên, superadmin)', async () => {
    await addUser('mod@example.com', 'Nhân Viên Kiểm Duyệt', 'moderator');
    await addUser('root@example.com', 'Nhân Viên Gốc', 'superadmin');
    const member = await addUser('nv-member@example.com', 'Nhân Viên Thường');
    expect((await search({ q: 'nhan vien' }).expect(200)).body.items).toEqual([{ id: member, displayName: 'Nhân Viên Thường' }]);
  });

  it('20 người mỗi trang, hasMore báo còn trang sau', async () => {
    for (let i = 0; i < 21; i++) await addUser(`trang-${i}@example.com`, `Tráng ${String(i).padStart(2, '0')}`);
    const first = await search({ q: 'trang' }).expect(200);
    expect(first.body.items).toHaveLength(20);
    expect(first.body.hasMore).toBe(true);
    const second = await search({ q: 'trang', page: 2 }).expect(200);
    expect(second.body).toMatchObject({ page: 2, hasMore: false });
    expect(second.body.items).toEqual([expect.objectContaining({ displayName: 'Tráng 20' })]);
  });

  it('chỉ đi sâu tới trang 5: trang 5 không mời tải tiếp, trang 6 bị từ chối', async () => {
    for (let i = 0; i < 101; i++) await addUser(`sau-${i}@example.com`, `Sâu ${String(i).padStart(3, '0')}`);
    const last = await search({ q: 'sau', page: 5 }).expect(200);
    expect(last.body.items).toHaveLength(20);
    expect(last.body.hasMore).toBe(false);
    await search({ q: 'sau', page: 6 }).expect(400);
  });

  it('từ khoá thiếu, dưới 2 ký tự (kể cả độn ký tự vô hình) hoặc quá 50 ký tự: 400', async () => {
    await search({}).expect(400);
    await search({ q: '   ' }).expect(400);
    await search({ q: 'a' }).expect(400);
    await search({ q: `a${String.fromCharCode(0x200b, 0x202e, 0x0000)}` }).expect(400);
    await search({ q: 'a'.repeat(51) }).expect(400);
    await search({ q: 'bao', page: 0 }).expect(400);
  });

  it('ký tự đại diện của LIKE được coi là chữ thường', async () => {
    await addUser('percent@example.com', '100% Phần Trăm');
    expect((await search({ q: '%%' }).expect(200)).body.items).toEqual([]);
    expect((await search({ q: '__' }).expect(200)).body.items).toEqual([]);
    expect((await search({ q: '0%' }).expect(200)).body.items).toHaveLength(1);
  });

  it('quá 30 lần một phút trên một IP: 429 kèm Retry-After, IP khác vẫn tìm được', async () => {
    for (let i = 0; i < 30; i++) await search({ q: 'zz' }).expect(200);
    const blocked = await search({ q: 'zz' }).expect(429);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    expect(blocked.body.retryAfterSeconds).toBeGreaterThan(0);
    await search({ q: 'zz' }, '198.51.100.7').expect(200);
  });

  it('IPv6 cùng dải /64 dùng chung giới hạn', async () => {
    for (let i = 0; i < 30; i++) await search({ q: 'zz' }, `2001:db8:1:2::${(i + 1).toString(16)}`).expect(200);
    await search({ q: 'zz' }, '2001:db8:1:2:ffff::1').expect(429);
    await search({ q: 'zz' }, '2001:db8:1:3::1').expect(200);
  });
});
