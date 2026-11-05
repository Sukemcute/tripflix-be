import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { MemorySidBlocklist } from '@tripflix/auth';
import { createNoOpTransactionalPlugins } from '@tripflix/db';
import { ClsModule } from 'nestjs-cls';
import { AccessError } from '../domain/errors.js';
import { REFRESH_GRACE_MS } from '../domain/refresh-rotation.js';
import { MemoryAccessStore } from '../infra/memory/memory-access.store.js';
import { MemoryLoginRateLimiter } from '../infra/memory/memory-login-rate-limiter.js';
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
  const auth = new AuthUseCases(store, hasher, issuer, new MemoryLoginRateLimiter(() => nowMs), blocklist, clock, google);
  await auth.register({ email: 'An@Example.com', password: 'mat-khau-1', displayName: 'An' }, meta);
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
  });

  it('dùng lại token cũ trong 10 giây vẫn được cấp cặp mới, không thu hồi phiên', async () => {
    const { auth, store, first, sid, advance } = await setup();
    await auth.refresh(first.refreshToken, meta);
    advance(REFRESH_GRACE_MS - 1_000);
    const retry = await auth.refresh(first.refreshToken, meta);

    expect(store.sessionRows.has(sid)).toBe(true);
    expect(store.sessionRows.get(sid)!.refreshTokenHash).toBe(hashRefreshToken(retry.refreshToken));
  });

  it('dùng lại token cũ sau 10 giây: thu hồi cả phiên, chặn sid, ghi audit', async () => {
    const { auth, store, blocklist, first, sid, advance } = await setup();
    const second = await auth.refresh(first.refreshToken, meta);
    advance(REFRESH_GRACE_MS + 1_000);

    await expect(auth.refresh(first.refreshToken, meta)).rejects.toMatchObject({ code: 'session_revoked' });
    expect(store.sessionRows.has(sid)).toBe(false);
    expect(await blocklist.isBlocked(sid)).toBe(true);
    expect(store.auditRows.map((a) => a.action)).toContain('auth.refresh_reused');
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
