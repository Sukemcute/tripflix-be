import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  ACCESS_STORE,
  LOGIN_RATE_LIMITER,
  PASSWORD_HASHER,
  TOKEN_ISSUER,
  type AccessStore,
  type Clock,
  type LoginRateLimiter,
  type PasswordHasher,
  type RequestMeta,
  type TokenIssuer,
} from '../../auth/application/ports.js';
import { TOO_MANY_ATTEMPTS_MESSAGE } from '../../auth/domain/credentials.js';
import { AccessError } from '../../auth/domain/errors.js';
import {
  INVALID_SERVICE_CREDENTIALS_MESSAGE,
  checkServiceClientInput,
  type ServiceTokenDenial,
} from '../domain/service-client-rules.js';

export interface ServiceTokenResponse {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
}

/** Khoá đếm lần xin token sai, dùng chung bộ đếm đăng nhập sai (5 lần theo client, 20 lần theo IP / 15 phút). */
const buildLimitKey = (clientId: string) => `service:${clientId}`;

/**
 * Cấp token service-to-service (docs/10 §3.10). Mọi lý do từ chối trả cùng một thông báo 401;
 * lý do thật ghi vào audit_logs. Client không tồn tại vẫn chạy argon2 để không lộ client nào có thật.
 */
@Injectable()
export class ServiceTokenUseCases {
  private dummyHash?: Promise<string>;

  constructor(
    @Inject(ACCESS_STORE) private readonly store: AccessStore,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    @Inject(TOKEN_ISSUER) private readonly tokens: TokenIssuer,
    @Inject(LOGIN_RATE_LIMITER) private readonly limiter: LoginRateLimiter,
  ) {}

  async issueToken(
    input: { clientId: string; clientSecret: string; audience: string },
    meta: RequestMeta,
  ): Promise<ServiceTokenResponse> {
    const limitKey = buildLimitKey(input.clientId);
    const limit = await this.limiter.check(limitKey, meta.ip);
    if (limit.isBlocked) throw new AccessError('too_many_attempts', TOO_MANY_ATTEMPTS_MESSAGE, limit.retryAfterSeconds);

    const client = await this.store.serviceClients.findById(input.clientId);
    const isSecretValid = client
      ? await this.hasher.verify(client.secretHash, input.clientSecret)
      : await this.hasher.verify(await this.getDummyHash(), input.clientSecret).then(() => false);

    const denial: ServiceTokenDenial | null = !client
      ? 'unknown_client'
      : !isSecretValid
        ? 'wrong_secret'
        : client.disabledAt
          ? 'disabled'
          : !client.allowedAudiences.includes(input.audience)
            ? 'audience_not_allowed'
            : null;
    if (denial) {
      await this.limiter.recordFailure(limitKey, meta.ip);
      await this.store.audit.record({
        action: 'service.token_failed',
        ...meta,
        meta: { clientId: input.clientId, audience: input.audience, reason: denial },
      });
      throw new AccessError('invalid_credentials', INVALID_SERVICE_CREDENTIALS_MESSAGE);
    }

    await this.limiter.reset(limitKey);
    // Không ghi audit mỗi lần cấp thành công: service xin token mỗi 5 phút, audit sẽ đầy dòng vô ích.
    const issued = await this.tokens.issueServiceToken({ clientId: input.clientId, audience: input.audience });
    return { accessToken: issued.token, tokenType: 'Bearer', expiresIn: issued.expiresIn };
  }

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= this.hasher.hash('tripflix-dummy-service-secret-for-timing');
    return this.dummyHash;
  }
}

/** Secret 256 bit dạng base64url (43 ký tự), chỉ in ra một lần khi tạo client. */
export function generateServiceSecret(): string {
  return randomBytes(32).toString('base64url');
}

/** Tạo client cho CLI. Trả secret gốc để in ra; database chỉ giữ bản băm. */
export async function registerServiceClient(
  deps: { store: AccessStore; hasher: PasswordHasher; userAudience: string },
  input: { clientId: string; audiences: string[] },
): Promise<{ clientSecret: string }> {
  const audiences = [...new Set(input.audiences)];
  const problem = checkServiceClientInput({ clientId: input.clientId, audiences }, deps.userAudience);
  if (problem) throw new Error(problem);
  const clientSecret = generateServiceSecret();
  const created = await deps.store.serviceClients.insert({
    clientId: input.clientId,
    secretHash: await deps.hasher.hash(clientSecret),
    allowedAudiences: audiences,
  });
  if (!created) throw new Error(`clientId "${input.clientId}" đã có. Muốn đổi secret thì vô hiệu hoá rồi tạo client tên khác`);
  await deps.store.audit.record({ action: 'service.client_created', meta: { clientId: input.clientId, audiences } });
  return { clientSecret };
}

/** Vô hiệu hoá client cho CLI: token mới bị từ chối ngay, token đã cấp hết hạn sau tối đa 5 phút. */
export async function disableServiceClient(deps: { store: AccessStore; now: Clock }, clientId: string): Promise<void> {
  if (!(await deps.store.serviceClients.disable(clientId, deps.now()))) throw new Error(`Không có clientId "${clientId}"`);
  await deps.store.audit.record({ action: 'service.client_disabled', meta: { clientId } });
}
