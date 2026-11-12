import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
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
const ALLOW_WHEN_REVOCATION_UNAVAILABLE_KEY = 'tripflix:allow-when-revocation-unavailable';
/** Thời gian tối đa chờ Redis ở các API đã bật @AllowWhenRevocationUnavailable. */
export const REVOCATION_CHECK_TIMEOUT_MS = 300;

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

/** Hỏi blocklist, quá REVOCATION_CHECK_TIMEOUT_MS thì ném lỗi; bên gọi tự quyết xử lý lỗi. */
async function isBlockedWithinTimeout(blocklist: SidBlocklist, sid: string): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`quá ${REVOCATION_CHECK_TIMEOUT_MS} ms`)), REVOCATION_CHECK_TIMEOUT_MS);
  });
  try {
    return await Promise.race([blocklist.isBlocked(sid), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Kiểm access token (chữ ký, iss, aud, exp) và sid chưa bị chặn; gắn req.user. */
@Injectable()
export class AccessTokenGuard implements CanActivate {
  private readonly logger = new Logger(AccessTokenGuard.name);

  constructor(
    @Inject(AUTH_VERIFIER) private readonly verify: AccessTokenVerifier,
    @Inject(SID_BLOCKLIST) private readonly blocklist: SidBlocklist,
    @Inject(Reflector) private readonly reflector: Reflector = new Reflector(),
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
    if (await this.isRevoked(context, user.sid)) throw new UnauthorizedException(UNAUTHORIZED_MESSAGE);
    req.user = user;
    return true;
  }

  private isRevoked(context: ExecutionContext, sid: string): Promise<boolean> {
    const canSkipCheck = this.reflector.getAllAndOverride<boolean | undefined>(ALLOW_WHEN_REVOCATION_UNAVAILABLE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    return canSkipCheck ? this.isRevokedWithinTimeout(sid) : this.blocklist.isBlocked(sid);
  }

  /** Redis lỗi hoặc chậm thì coi như chưa thu hồi: token vẫn được kiểm chữ ký và hạn dùng. */
  private async isRevokedWithinTimeout(sid: string): Promise<boolean> {
    try {
      return await isBlockedWithinTimeout(this.blocklist, sid);
    } catch (err) {
      this.logger.warn(`Không kiểm được phiên thu hồi, cho đi tiếp: ${(err as Error).message}`);
      return false;
    }
  }
}

/**
 * Đăng nhập tuỳ chọn cho route công khai có cá nhân hoá: không bao giờ ném 401.
 * Không token, token sai hoặc hết hạn, sid bị chặn → khách (req.user không gán). Token hợp lệ → gán req.user.
 * Blocklist lỗi hoặc quá REVOCATION_CHECK_TIMEOUT_MS cũng coi như khách: route vẫn chạy được khi Redis sập,
 * và không tin một token có thể đã thu hồi.
 */
@Injectable()
export class OptionalAuthGuard implements CanActivate {
  private readonly logger = new Logger(OptionalAuthGuard.name);

  constructor(
    @Inject(AUTH_VERIFIER) private readonly verify: AccessTokenVerifier,
    @Inject(SID_BLOCKLIST) private readonly blocklist: SidBlocklist,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthRequest>();
    const token = extractBearerToken(req);
    if (!token) return true;
    try {
      const user = await this.verify(token);
      if (!(await isBlockedWithinTimeout(this.blocklist, user.sid))) req.user = user;
    } catch (err) {
      if (!(err instanceof InvalidAccessTokenError)) {
        this.logger.warn(`Không kiểm được token tuỳ chọn, coi như khách: ${(err as Error).message}`);
      }
    }
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

/** Đăng nhập tuỳ chọn: khách vẫn qua, lấy người dùng bằng @OptionalCurrentUser. */
export const OptionalAuthenticated = () => UseGuards(OptionalAuthGuard);

/** Bắt buộc đăng nhập và có một trong các vai trò. Dùng cho controller hoặc từng handler. */
export const Roles = (...roles: Role[]) =>
  applyDecorators(SetMetadata(ROLES_KEY, roles), UseGuards(AccessTokenGuard, RolesGuard));

/**
 * Bắt buộc đăng nhập và đã xác thực email (TF05D). Dùng cho thao tác tạo nội dung (đăng bài, bình luận) để chặn
 * spam bằng email không có thật. Dùng được cùng @Authenticated hoặc @Roles ở controller.
 */
export const RequireVerifiedEmail = () => UseGuards(AccessTokenGuard, VerifiedEmailGuard);

/**
 * Luồng phải chạy được khi Redis sập (đặt chỗ, thanh toán): Redis lỗi hoặc chậm thì bỏ qua bước kiểm phiên thu hồi.
 * Đánh đổi: trong lúc đó token đã thu hồi vẫn dùng được tới khi hết hạn. Không dùng cho API quản trị.
 */
export const AllowWhenRevocationUnavailable = () => SetMetadata(ALLOW_WHEN_REVOCATION_UNAVAILABLE_KEY, true);

/** Lấy người dùng đã kiểm từ request (chỉ dùng sau @Authenticated hoặc @Roles). */
export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext): AuthUser => {
  const user = context.switchToHttp().getRequest<AuthRequest>().user;
  if (!user) throw new UnauthorizedException(UNAUTHORIZED_MESSAGE);
  return user;
});

/** Người dùng đã kiểm nếu có, undefined nếu là khách (dùng sau @OptionalAuthenticated). */
export const OptionalCurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthUser | undefined =>
    context.switchToHttp().getRequest<AuthRequest>().user,
);
