import 'reflect-metadata';
import { ForbiddenException, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AccessTokenGuard, Roles, RolesGuard } from './guards.js';
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
