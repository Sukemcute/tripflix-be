import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { MemorySidBlocklist } from '@tripflix/auth';
import { createNoOpTransactionalPlugins } from '@tripflix/db';
import { ClsModule } from 'nestjs-cls';
import { AccessError } from '../domain/errors.js';
import { REFRESH_GRACE_MS, SESSION_MAX_AGE_MS } from '../domain/refresh-rotation.js';
import { MemoryAccessStore } from '../infra/memory/memory-access.store.js';
import { MemoryLoginRateLimiter } from '../infra/memory/memory-login-rate-limiter.js';
import { MemoryActionRateLimiter } from '../infra/memory/memory-action-rate-limiter.js';
import type { CoreEnv } from '../../../../platform/env.js';
import { AuthUseCases } from './auth.use-cases.js';
import type { PasswordHasher, TokenIssuer } from './ports.js';
import { hashRefreshToken } from './refresh-token.js';

const meta = { ip: '10.0.0.1', userAgent: 'vitest' };
const hasher: PasswordHasher = {
  hash: async (p) => `hashed:${p}`,
  verify: async (h, p) => h === `hashed:${p}`,
};
const issuer: TokenIssuer = {
  issue: async ({ sid }) => ({ token: `access-for-${sid}`, expiresIn: 900 }),
  issueServiceToken: async ({ clientId }) => ({ token: `service-for-${clientId}`, expiresIn: 300 }),
  getJwks: () => ({ keys: [] }),
};

// Khởi tạo TransactionHost (plugin no-op) một lần để @Transactional('access') chạy được khi tạo use case trực tiếp.
beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [ClsModule.forRoot({ global: true, plugins: createNoOpTransactionalPlugins() })],
  }).compile();
  await moduleRef.init();
});

async function setup() {
  let nowMs = Date.parse('2026-11-04T10:00:00Z');
  const clock = () => new Date(nowMs);
  const store = new MemoryAccessStore();
  const blocklist = new MemorySidBlocklist(() => nowMs);
  const google = { verify: async () => Promise.reject(new Error('không dùng trong test này')) };
  const actionLimiter = new MemoryActionRateLimiter();
  const env = {} as CoreEnv;
  const auth = new AuthUseCases(
    store,
    hasher,
    issuer,
    new MemoryLoginRateLimiter(() => nowMs),
    blocklist,
    clock,
    google,
    actionLimiter,
    env,
  );
  await store.users.insert({ email: 'an@example.com', passwordHash: await hasher.hash('mat-khau-1'), displayName: 'An', role: 'member' });
  const first = await auth.login({ email: 'an@example.com', password: 'mat-khau-1' }, meta);
  const sid = [...store.sessionRows.keys()][0]!;
  return { auth, store, blocklist, first, sid, advance: (ms: number) => (nowMs += ms) };
}

describe('AuthUseCases.refresh', () => {
  it('xoay vòng: cấp refresh token mới, chỉ lưu bản băm, token cũ thành token liền trước', async () => {
    const { auth, store, first, sid, advance } = await setup();
    advance(60_000);
    const second = await auth.refresh(first.refreshToken, meta);

    expect(second.refreshToken).not.toBe(first.refreshToken);
    const row = store.sessionRows.get(sid)!;
    expect(row.refreshTokenHash).toBe(hashRefreshToken(second.refreshToken));
    expect(row.previousTokenHash).toBe(hashRefreshToken(first.refreshToken));
    expect(JSON.stringify(row)).not.toContain(second.refreshToken);
    expect(store.auditRows.map((a) => a.action)).not.toContain('auth.refresh');
  });

  it('dùng lại token cũ trong 10 giây vẫn được cấp cặp mới, không thu hồi phiên', async () => {
    const { auth, store, first, sid, advance } = await setup();
    await auth.refresh(first.refreshToken, meta);
    advance(REFRESH_GRACE_MS - 1_000);
    const retry = await auth.refresh(first.refreshToken, meta);

    expect(store.sessionRows.has(sid)).toBe(true);
    expect(store.sessionRows.get(sid)!.refreshTokenHash).toBe(hashRefreshToken(retry.refreshToken));
  });

  it('phiên quá 180 ngày kể từ lúc đăng nhập thì không làm mới được nữa, dù vẫn refresh đều', async () => {
    const { auth, store, first, sid, advance } = await setup();
    const row = store.sessionRows.get(sid)!;
    const loginAt = new Date(Date.parse('2026-11-04T10:00:00Z') - SESSION_MAX_AGE_MS + 24 * 60 * 60 * 1000);
    store.sessionRows.set(sid, { ...row, createdAt: loginAt });

    const second = await auth.refresh(first.refreshToken, meta);
    expect(store.sessionRows.get(sid)!.expiresAt.getTime()).toBe(loginAt.getTime() + SESSION_MAX_AGE_MS);
    advance(24 * 60 * 60 * 1000 + 1_000);
    await expect(auth.refresh(second.refreshToken, meta)).rejects.toMatchObject({ code: 'invalid_refresh' });
  });

  it('dùng lại token cũ sau 10 giây: thu hồi cả phiên, chặn sid, ghi audit', async () => {
    const { auth, store, blocklist, first, sid, advance } = await setup();
    const second = await auth.refresh(first.refreshToken, meta);
    advance(REFRESH_GRACE_MS + 1_000);

    await expect(auth.refresh(first.refreshToken, meta)).rejects.toMatchObject({ code: 'session_revoked' });
    expect(store.sessionRows.has(sid)).toBe(false);
    expect(await blocklist.isBlocked(sid)).toBe(true);
    expect(store.auditRows.map((a) => a.action)).toContain('auth.refresh_reused');
    const alerts = store.outboxRows.filter((e) => e.type === 'access.session_reuse_detected');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.payload).toMatchObject({ email: 'an@example.com', displayName: 'An' });
    // Request dùng lại lần hai không gửi thêm thư.
    await expect(auth.refresh(first.refreshToken, meta)).rejects.toBeInstanceOf(AccessError);
    expect(store.outboxRows.filter((e) => e.type === 'access.session_reuse_detected')).toHaveLength(1);
    // Token mới nhất của phiên đã thu hồi cũng không dùng được nữa.
    await expect(auth.refresh(second.refreshToken, meta)).rejects.toBeInstanceOf(AccessError);
  });

  it('từ chối refresh token lạ hoặc phiên hết hạn', async () => {
    const { auth, first, advance } = await setup();
    await expect(auth.refresh('khong-co-that', meta)).rejects.toMatchObject({ code: 'invalid_refresh' });
    advance(31 * 24 * 60 * 60 * 1000);
    await expect(auth.refresh(first.refreshToken, meta)).rejects.toMatchObject({ code: 'invalid_refresh' });
  });
});

describe('AuthUseCases.login', () => {
  it('sai email và sai mật khẩu trả cùng một lỗi', async () => {
    const { auth } = await setup();
    const wrongPassword = auth.login({ email: 'an@example.com', password: 'sai' }, meta);
    const wrongEmail = auth.login({ email: 'khong@example.com', password: 'mat-khau-1' }, meta);
    const [a, b] = await Promise.allSettled([wrongPassword, wrongEmail]);
    expect(a.status === 'rejected' && a.reason).toEqual(b.status === 'rejected' && b.reason);
  });
});
