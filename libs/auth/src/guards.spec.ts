import 'reflect-metadata';
import { ForbiddenException, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants.js';
import { Reflector } from '@nestjs/core';
import {
  AccessTokenGuard,
  AllowWhenRevocationUnavailable,
  EMAIL_UNVERIFIED_CODE,
  EMAIL_UNVERIFIED_MESSAGE,
  OptionalAuthGuard,
  REVOCATION_CHECK_TIMEOUT_MS,
  RequireVerifiedEmail,
  Roles,
  RolesGuard,
  VerifiedEmailGuard,
} from './guards.js';
import { MemorySidBlocklist } from './revocation.js';
import { InvalidAccessTokenError, type AuthUser } from './verifier.js';

const member: AuthUser = { userId: 'u-1', role: 'member', sid: 's-1', exp: 0 };

function context(req: Record<string, unknown>, handler: () => void = () => undefined): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => handler,
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

describe('AccessTokenGuard', () => {
  const verify = async (token: string) => {
    if (token === 'good') return member;
    throw new InvalidAccessTokenError();
  };

  it('gắn req.user khi token đúng', async () => {
    const req = { headers: { authorization: 'Bearer good' } } as Record<string, unknown>;
    await expect(new AccessTokenGuard(verify, new MemorySidBlocklist()).canActivate(context(req))).resolves.toBe(
      true,
    );
    expect(req.user).toEqual(member);
  });

  it('trả 401 khi thiếu header hoặc token sai', async () => {
    const guard = new AccessTokenGuard(verify, new MemorySidBlocklist());
    await expect(guard.canActivate(context({ headers: {} }))).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      guard.canActivate(context({ headers: { authorization: 'Bearer bad' } })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('trả 401 khi sid đã bị chặn', async () => {
    const blocklist = new MemorySidBlocklist();
    await blocklist.block('s-1', 900);
    const guard = new AccessTokenGuard(verify, blocklist);
    await expect(
      guard.canActivate(context({ headers: { authorization: 'Bearer good' } })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('AccessTokenGuard khi không kiểm được phiên thu hồi', () => {
  const verify = async () => member;
  const brokenBlocklist = { block: async () => undefined, isBlocked: async () => Promise.reject(new Error('redis down')) };
  const slowBlocklist = { block: async () => undefined, isBlocked: () => new Promise<boolean>(() => undefined) };
  const req = () => ({ headers: { authorization: 'Bearer good' } }) as Record<string, unknown>;
  class Ctrl {
    @AllowWhenRevocationUnavailable()
    book() {}
    admin() {}
  }

  it('API đã bật: Redis lỗi thì vẫn cho đi tiếp', async () => {
    const guard = new AccessTokenGuard(verify, brokenBlocklist);
    await expect(guard.canActivate(context(req(), Ctrl.prototype.book))).resolves.toBe(true);
  });

  it('API đã bật: Redis treo thì cho đi tiếp đúng sau thời gian chờ', async () => {
    vi.useFakeTimers();
    try {
      const passed = new AccessTokenGuard(verify, slowBlocklist).canActivate(context(req(), Ctrl.prototype.book));
      await vi.advanceTimersByTimeAsync(REVOCATION_CHECK_TIMEOUT_MS);
      await expect(passed).resolves.toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('API đã bật: Redis bình thường thì phiên bị chặn vẫn 401', async () => {
    const blocklist = new MemorySidBlocklist();
    await blocklist.block('s-1', 900);
    const guard = new AccessTokenGuard(verify, blocklist);
    await expect(guard.canActivate(context(req(), Ctrl.prototype.book))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('API chưa bật: giữ hành vi cũ, lỗi Redis được ném ra', async () => {
    const guard = new AccessTokenGuard(verify, brokenBlocklist);
    await expect(guard.canActivate(context(req(), Ctrl.prototype.admin))).rejects.toThrow('redis down');
  });
});

describe('RolesGuard', () => {
  class Ctrl {
    @Roles('superadmin')
    staff() {}
  }
  const guard = new RolesGuard(new Reflector());
  const handler = Ctrl.prototype.staff;

  it('trả 403 khi vai trò không nằm trong @Roles', () => {
    expect(() => guard.canActivate(context({ user: member }, handler))).toThrow(ForbiddenException);
  });

  it('cho qua khi đúng vai trò', () => {
    expect(guard.canActivate(context({ user: { ...member, role: 'superadmin' } }, handler))).toBe(true);
  });
});

describe('TF05D: VerifiedEmailGuard, RequireVerifiedEmail', () => {
  const guard = new VerifiedEmailGuard();

  it('cho qua khi emailVerified là true', () => {
    expect(guard.canActivate(context({ user: { ...member, emailVerified: true } }))).toBe(true);
  });

  it('403 kèm code email_unverified khi chưa xác thực hoặc AuthUser không có trường này', () => {
    for (const user of [{ ...member, emailVerified: false }, member]) {
      let caught: unknown;
      try {
        guard.canActivate(context({ user }));
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(ForbiddenException);
      expect((caught as ForbiddenException).getResponse()).toEqual({
        statusCode: 403,
        message: EMAIL_UNVERIFIED_MESSAGE,
        code: EMAIL_UNVERIFIED_CODE,
      });
    }
  });

  it('401 khi chưa qua AccessTokenGuard (không có req.user)', () => {
    expect(() => guard.canActivate(context({}))).toThrow(UnauthorizedException);
  });

  it('@RequireVerifiedEmail gắn AccessTokenGuard rồi VerifiedEmailGuard theo đúng thứ tự', () => {
    class Ctrl {
      @RequireVerifiedEmail()
      createPost() {}
    }
    const guards = Reflect.getMetadata(GUARDS_METADATA, Ctrl.prototype.createPost) as unknown[];
    expect(guards).toEqual([AccessTokenGuard, VerifiedEmailGuard]);
  });
});

describe('OptionalAuthGuard', () => {
  const verify = async (token: string) => {
    if (token === 'good') return member;
    throw new InvalidAccessTokenError();
  };
  const req = (authorization?: string) =>
    ({ headers: authorization ? { authorization } : {} }) as Record<string, unknown>;

  it('không token: cho qua như khách', async () => {
    const r = req();
    await expect(new OptionalAuthGuard(verify, new MemorySidBlocklist()).canActivate(context(r))).resolves.toBe(true);
    expect(r.user).toBeUndefined();
  });

  it('token hợp lệ: gắn req.user', async () => {
    const r = req('Bearer good');
    await expect(new OptionalAuthGuard(verify, new MemorySidBlocklist()).canActivate(context(r))).resolves.toBe(true);
    expect(r.user).toEqual(member);
  });

  it('token sai: cho qua như khách, không 401', async () => {
    const r = req('Bearer bad');
    await expect(new OptionalAuthGuard(verify, new MemorySidBlocklist()).canActivate(context(r))).resolves.toBe(true);
    expect(r.user).toBeUndefined();
  });

  it('sid bị chặn: cho qua như khách', async () => {
    const blocklist = new MemorySidBlocklist();
    await blocklist.block('s-1', 900);
    const r = req('Bearer good');
    await expect(new OptionalAuthGuard(verify, blocklist).canActivate(context(r))).resolves.toBe(true);
    expect(r.user).toBeUndefined();
  });

  it('blocklist lỗi: cho qua như khách', async () => {
    const broken = { block: async () => undefined, isBlocked: async () => Promise.reject(new Error('redis down')) };
    const r = req('Bearer good');
    await expect(new OptionalAuthGuard(verify, broken).canActivate(context(r))).resolves.toBe(true);
    expect(r.user).toBeUndefined();
  });

  it('blocklist treo: cho qua như khách sau thời gian chờ', async () => {
    vi.useFakeTimers();
    try {
      const slow = { block: async () => undefined, isBlocked: () => new Promise<boolean>(() => undefined) };
      const r = req('Bearer good');
      const passed = new OptionalAuthGuard(verify, slow).canActivate(context(r));
      await vi.advanceTimersByTimeAsync(REVOCATION_CHECK_TIMEOUT_MS);
      await expect(passed).resolves.toBe(true);
      expect(r.user).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
