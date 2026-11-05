import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  Inject,
  Injectable,
  UseGuards,
} from '@nestjs/common';
import {
  AUTH_VERIFIER,
  SID_BLOCKLIST,
  type AccessTokenVerifier,
  type AuthUser,
  type SidBlocklist,
} from '@tripflix/auth';

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

/**
 * Guard kiểm tra token tuỳ chọn cho các route công khai (public) nhưng có ngữ cảnh cá nhân hoá:
 * - Nếu không có Bearer token -> Cho qua, req.user = undefined (khách vãng lai).
 * - Nếu có Bearer token -> Verify chữ ký và blocklist sid. Nếu hợp lệ, gán req.user.
 * - Nếu token sai/hết hạn -> Cho qua như khách vãng lai (không ném 401).
 */
@Injectable()
export class OptionalAuthGuard implements CanActivate {
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
      if (!(await this.blocklist.isBlocked(user.sid))) {
        req.user = user;
      }
    } catch {
      // Token sai hoặc hết hạn -> không gán req.user, tiếp tục như anonymous
    }
    return true;
  }
}

export const OptionalAuthenticated = () => UseGuards(OptionalAuthGuard);

/**
 * Decorator lấy AuthUser nếu đã xác thực, trả về undefined nếu là khách vãng lai.
 */
export const OptionalCurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthUser | undefined => {
    return context.switchToHttp().getRequest<AuthRequest>().user;
  },
);
