import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  Optional,
  SetMetadata,
  UnauthorizedException,
  UseGuards,
  applyDecorators,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { jwtVerify, type JWTVerifyGetKey } from 'jose';
import { ACCESS_TOKEN_ALG } from './verifier.js';

/** Claim `typ` của token service; token người dùng không có claim này nên không lọt qua guard service. */
export const SERVICE_TOKEN_TYPE = 'service';
/** Token service sống 5 phút (docs/architecture/10 §3.10). */
export const SERVICE_TOKEN_TTL_SECONDS = 5 * 60;

export const SERVICE_VERIFIER = Symbol('SERVICE_VERIFIER');
const SERVICE_CLIENTS_KEY = 'tripflix:service-clients';

export const INVALID_SERVICE_TOKEN_MESSAGE = 'Token service không hợp lệ hoặc đã hết hạn';
export const SERVICE_NOT_ALLOWED_MESSAGE = 'Service này không được gọi API này';

/** Service gọi tới, đọc từ token service đã kiểm. */
export interface ServiceCaller {
  clientId: string;
  audience: string;
  exp: number;
}

export interface ServiceTokenVerifierOptions {
  keys: JWTVerifyGetKey;
  issuer: string;
  /** Tên service đang nhận request, ví dụ 'discovery'. Token phải có aud đúng tên này. */
  audience: string;
}

export type ServiceTokenVerifier = (token: string) => Promise<ServiceCaller>;

export class InvalidServiceTokenError extends Error {
  constructor(cause?: unknown) {
    super(INVALID_SERVICE_TOKEN_MESSAGE, { cause });
    this.name = 'InvalidServiceTokenError';
  }
}

export function createServiceTokenVerifier({ keys, issuer, audience }: ServiceTokenVerifierOptions): ServiceTokenVerifier {
  return async (token) => {
    let payload;
    try {
      ({ payload } = await jwtVerify(token, keys, {
        algorithms: [ACCESS_TOKEN_ALG],
        issuer,
        audience,
        requiredClaims: ['sub', 'typ', 'iat', 'exp'],
      }));
    } catch (err) {
      throw new InvalidServiceTokenError(err);
    }
    if (payload.typ !== SERVICE_TOKEN_TYPE || !payload.sub || typeof payload.exp !== 'number') {
      throw new InvalidServiceTokenError();
    }
    return { clientId: payload.sub, audience, exp: payload.exp };
  };
}

interface ServiceRequest {
  headers: Record<string, string | string[] | undefined>;
  serviceCaller?: ServiceCaller;
}

function extractBearerToken(req: ServiceRequest): string | undefined {
  const header = req.headers.authorization;
  const value = Array.isArray(header) ? header[0] : header;
  return value ? /^Bearer\s+(\S+)$/i.exec(value)?.[1] : undefined;
}

/** Chỉ cho token service hợp lệ; nếu @ServiceOnly có danh sách client thì client phải nằm trong đó. */
@Injectable()
export class ServiceTokenGuard implements CanActivate {
  constructor(
    @Optional() @Inject(SERVICE_VERIFIER) private readonly verify: ServiceTokenVerifier | null,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.verify) throw new Error('ServiceTokenGuard chưa cấu hình: truyền serviceVerifier cho AuthModule.forRootAsync');
    const req = context.switchToHttp().getRequest<ServiceRequest>();
    const token = extractBearerToken(req);
    if (!token) throw new UnauthorizedException(INVALID_SERVICE_TOKEN_MESSAGE);
    let caller: ServiceCaller;
    try {
      caller = await this.verify(token);
    } catch (err) {
      if (err instanceof InvalidServiceTokenError) throw new UnauthorizedException(INVALID_SERVICE_TOKEN_MESSAGE);
      throw err;
    }
    const allowed = this.reflector.getAllAndOverride<string[] | undefined>(SERVICE_CLIENTS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (allowed && allowed.length > 0 && !allowed.includes(caller.clientId)) {
      throw new ForbiddenException(SERVICE_NOT_ALLOWED_MESSAGE);
    }
    req.serviceCaller = caller;
    return true;
  }
}

/**
 * API nội bộ chỉ cho service gọi (không cho người dùng). Truyền clientId để giới hạn service nào được gọi,
 * ví dụ `@ServiceOnly('ai-service')`; bỏ trống thì mọi service có token hợp lệ cho aud này đều gọi được.
 */
export const ServiceOnly = (...clientIds: string[]) =>
  applyDecorators(SetMetadata(SERVICE_CLIENTS_KEY, clientIds), UseGuards(ServiceTokenGuard));

export const CurrentService = createParamDecorator((_data: unknown, context: ExecutionContext): ServiceCaller => {
  const caller = context.switchToHttp().getRequest<ServiceRequest>().serviceCaller;
  if (!caller) throw new UnauthorizedException(INVALID_SERVICE_TOKEN_MESSAGE);
  return caller;
});
