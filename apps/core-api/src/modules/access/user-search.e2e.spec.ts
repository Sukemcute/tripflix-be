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
  const search = (query: Record<string, string | number>) => request(app.getHttpServer()).get('/api/v1/users/search').query(query);

  async function addUser(email: string, displayName: string) {
    const user = await store.users.insert({ email, passwordHash: null, displayName, role: 'member' });
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
    applyGlobalPrefix(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('không cần đăng nhập, "bao" khớp "Bảo", chỉ trả id và tên hiển thị', async () => {
    const id = await addUser('bao-le@example.com', 'Lê Bảo');
    const res = await search({ q: 'BAO' }).expect(200);
    expect(res.body).toEqual({ items: [{ id, displayName: 'Lê Bảo' }], page: 1, hasMore: false });
    expect((await search({ q: 'lê bảo' }).expect(200)).body.items).toEqual([{ id, displayName: 'Lê Bảo' }]);
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

  it('20 người mỗi trang, hasMore báo còn trang sau', async () => {
    for (let i = 0; i < 21; i++) await addUser(`trang-${i}@example.com`, `Tráng ${String(i).padStart(2, '0')}`);
    const first = await search({ q: 'trang' }).expect(200);
    expect(first.body.items).toHaveLength(20);
    expect(first.body.hasMore).toBe(true);
    const second = await search({ q: 'trang', page: 2 }).expect(200);
    expect(second.body).toMatchObject({ page: 2, hasMore: false });
    expect(second.body.items).toEqual([expect.objectContaining({ displayName: 'Tráng 20' })]);
  });

  it('từ khoá rỗng, chỉ có khoảng trắng hoặc quá 50 ký tự: 400', async () => {
    await search({}).expect(400);
    await search({ q: '   ' }).expect(400);
    await search({ q: 'a'.repeat(51) }).expect(400);
    await search({ q: 'bao', page: 0 }).expect(400);
  });
});
