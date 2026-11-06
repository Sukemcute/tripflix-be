import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  UseGuards,
  applyDecorators,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '@tripflix/contracts';
import type { SidBlocklist } from './revocation.js';
import { InvalidAccessTokenError, type AccessTokenVerifier, type AuthUser } from './verifier.js';

export const AUTH_VERIFIER = Symbol('AUTH_VERIFIER');
export const SID_BLOCKLIST = Symbol('SID_BLOCKLIST');
const ROLES_KEY = 'tripflix:roles';

export const UNAUTHORIZED_MESSAGE = 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn';
export const FORBIDDEN_MESSAGE = 'Bạn không có quyền dùng chức năng này';
export const EMAIL_UNVERIFIED_MESSAGE = 'Bạn cần xác thực email trước khi dùng chức năng này';
/** Mã trong body 403 để client phân biệt với thiếu quyền (hiện nút gửi lại email xác thực). */
export const EMAIL_UNVERIFIED_CODE = 'email_unverified';

interface AuthRequest {
  headers: Record<string, string | string[] | undefined>;
  user?: AuthUser;
}

function extractBearerToken(req: AuthRequest): string | undefined {
  const header = req.headers.authorization;
  const value = Array.isArray(header) ? header[0] : header;
  const match = value ? /^Bearer\s+(\S+)$/i.exec(value) : null;
  return match?.[1];
}

/** Kiểm access token (chữ ký, iss, aud, exp) và sid chưa bị chặn; gắn req.user. */
@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(
    @Inject(AUTH_VERIFIER) private readonly verify: AccessTokenVerifier,
    @Inject(SID_BLOCKLIST) private readonly blocklist: SidBlocklist,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthRequest>();
    const token = extractBearerToken(req);
    if (!token) throw new UnauthorizedException(UNAUTHORIZED_MESSAGE);
    let user: AuthUser;
    try {
      user = await this.verify(token);
    } catch (err) {
      if (err instanceof InvalidAccessTokenError) throw new UnauthorizedException(UNAUTHORIZED_MESSAGE);
      throw err;
    }
    if (await this.blocklist.isBlocked(user.sid)) throw new UnauthorizedException(UNAUTHORIZED_MESSAGE);
    req.user = user;
    return true;
  }
}

/** Chặn theo claim role; chạy sau AccessTokenGuard. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles || roles.length === 0) return true;
    const user = context.switchToHttp().getRequest<AuthRequest>().user;
    if (!user) throw new UnauthorizedException(UNAUTHORIZED_MESSAGE);
    if (!roles.includes(user.role)) throw new ForbiddenException(FORBIDDEN_MESSAGE);
    return true;
  }
}

/** Chặn tài khoản chưa xác thực email (claim ev); chạy sau AccessTokenGuard. 403 kèm code email_unverified. */
@Injectable()
export class VerifiedEmailGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest<AuthRequest>().user;
    if (!user) throw new UnauthorizedException(UNAUTHORIZED_MESSAGE);
    if (user.emailVerified !== true) {
      throw new ForbiddenException({
        statusCode: 403,
        message: EMAIL_UNVERIFIED_MESSAGE,
        code: EMAIL_UNVERIFIED_CODE,
      });
    }
    return true;
  }
}

/** Bắt buộc đăng nhập. */
export const Authenticated = () => UseGuards(AccessTokenGuard);

/** Bắt buộc đăng nhập và có một trong các vai trò. Dùng cho controller hoặc từng handler. */
export const Roles = (...roles: Role[]) =>
  applyDecorators(SetMetadata(ROLES_KEY, roles), UseGuards(AccessTokenGuard, RolesGuard));

/**
 * Bắt buộc đăng nhập và đã xác thực email (TF05D). Dùng cho thao tác tạo nội dung (đăng bài, bình luận) để chặn
 * spam bằng email không có thật. Dùng được cùng @Authenticated hoặc @Roles ở controller.
 */
export const RequireVerifiedEmail = () => UseGuards(AccessTokenGuard, VerifiedEmailGuard);

/** Lấy người dùng đã kiểm từ request (chỉ dùng sau @Authenticated hoặc @Roles). */
export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext): AuthUser => {
  const user = context.switchToHttp().getRequest<AuthRequest>().user;
  if (!user) throw new UnauthorizedException(UNAUTHORIZED_MESSAGE);
  return user;
});
