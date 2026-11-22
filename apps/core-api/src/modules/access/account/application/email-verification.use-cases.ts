import { Inject, Injectable } from '@nestjs/common';
import type { AccessEmailVerificationRequestedV1 } from '@tripflix/contracts';
import { Transactional } from '@tripflix/db';
import { DEFAULT_EMAIL_VERIFY_URL, type CoreEnv } from '../../../../platform/env.js';
import { CORE_ENV } from '../../../../platform/tokens.js';
import {
  ACCESS_STORE,
  ACTION_RATE_LIMITER,
  CLOCK,
  type AccessStore,
  type ActionRateLimiter,
  type Clock,
  type RequestMeta,
  type UserRecord,
} from '../../auth/application/ports.js';
import { createRefreshToken, hashRefreshToken } from '../../auth/application/refresh-token.js';
import { AccessError } from '../../auth/domain/errors.js';
import {
  EMAIL_VERIFICATION_TTL_MS,
  INVALID_VERIFY_TOKEN_MESSAGE,
  RESEND_MAX_PER_IP,
  RESEND_MAX_PER_USER,
  RESEND_WINDOW_SECONDS,
  TOO_MANY_RESENDS_MESSAGE,
  buildVerifyUrl,
} from '../domain/email-verification.js';

export type ResendResult = 'sent' | 'already_verified';

/**
 * Xác thực email (TF05D). Cùng cách với đặt lại mật khẩu: token 256 bit ngẫu nhiên, database chỉ giữ SHA-256,
 * link nằm trong sự kiện access.email_verification_requested (outbox, cùng transaction với token),
 * notification-service gửi email.
 */
@Injectable()
export class EmailVerificationUseCases {
  private readonly verifyPageUrl: string;

  constructor(
    @Inject(ACCESS_STORE) private readonly store: AccessStore,
    @Inject(ACTION_RATE_LIMITER) private readonly actionLimiter: ActionRateLimiter,
    @Inject(CLOCK) private readonly now: Clock,
    @Inject(CORE_ENV) env: CoreEnv,
  ) {
    // E2E dựng env tay có thể thiếu biến này: dùng mặc định như khi parse env.
    this.verifyPageUrl = (env.AUTH_EMAIL_VERIFY_URL as string | undefined) ?? DEFAULT_EMAIL_VERIFY_URL;
  }

  /**
   * Tạo link mới (link cũ chưa dùng hết hiệu lực), ghi audit và sự kiện. Phải gọi trong transaction đang mở:
   * khi đăng ký thì cùng transaction tạo tài khoản, nên tài khoản không tạo được thì không có email.
   */
  async issueInCurrentTransaction(
    user: UserRecord,
    reason: 'signup' | 'resend',
    meta: RequestMeta,
  ): Promise<void> {
    const token = createRefreshToken();
    const expiresAt = new Date(this.now().getTime() + EMAIL_VERIFICATION_TTL_MS);
    const replaced = await this.store.emailVerifications.deleteUnusedByUser(user.id);
    await this.store.emailVerifications.insert({
      userId: user.id,
      tokenHash: hashRefreshToken(token),
      expiresAt,
    });
    await this.store.audit.record({
      action: 'auth.email_verification_requested',
      actorUserId: user.id,
      ...meta,
      meta: { reason, replacedTokens: replaced, expiresAt: expiresAt.toISOString() },
    });
    const payload: AccessEmailVerificationRequestedV1 = {
      userId: user.id,
      email: user.email,
      displayName: user.displayName,
      verifyUrl: buildVerifyUrl(this.verifyPageUrl, token),
      expiresAt: expiresAt.toISOString(),
      reason,
    };
    await this.store.outbox.add({ type: 'access.email_verification_requested', userId: user.id, payload });
  }

  /** Người đang đăng nhập xin gửi lại link. Đã xác thực thì không gửi. Giới hạn đếm trước khi gửi. */
  async resend(userId: string, meta: RequestMeta): Promise<ResendResult> {
    const user = await this.store.users.findById(userId);
    if (!user || user.status !== 'active') throw new AccessError('not_found', 'Không tìm thấy người dùng');
    if (user.emailVerifiedAt) return 'already_verified';
    const [byUser, byIp] = await Promise.all([
      this.actionLimiter.consume(`verify-resend:user:${user.id}`, RESEND_MAX_PER_USER, RESEND_WINDOW_SECONDS),
      this.actionLimiter.consume(`verify-resend:ip:${meta.ip}`, RESEND_MAX_PER_IP, RESEND_WINDOW_SECONDS),
    ]);
    const blocked = [byUser, byIp].find((s) => s.isBlocked);
    if (blocked)
      throw new AccessError('too_many_attempts', TOO_MANY_RESENDS_MESSAGE, blocked.retryAfterSeconds);
    return this.issueResend(user.id, meta);
  }

  /** Token đúng, chưa dùng, chưa hết hạn: đánh dấu email đã xác thực. Sai: 400 cùng một câu. */
  @Transactional('access')
  async verify(input: { token: string }, meta: RequestMeta): Promise<void> {
    const tokenHash = hashRefreshToken(input.token);
    const verification = await this.store.emailVerifications.findUsable(tokenHash, this.now());
    if (!verification) throw new AccessError('invalid_verify_token', INVALID_VERIFY_TOKEN_MESSAGE);
    // Gửi lại và xác thực cùng khóa người dùng trước khi sửa token.
    const user = await this.store.users.lockById(verification.userId);
    if (!user || user.status !== 'active')
      throw new AccessError('invalid_verify_token', INVALID_VERIFY_TOKEN_MESSAGE);
    const now = this.now();
    const consumed = await this.store.emailVerifications.consume(tokenHash, now);
    if (!consumed) throw new AccessError('invalid_verify_token', INVALID_VERIFY_TOKEN_MESSAGE);
    const wasVerified = user.emailVerifiedAt !== null;
    await this.store.users.markEmailVerified(user.id, now);
    await this.store.emailVerifications.deleteUnusedByUser(user.id);
    await this.store.audit.record({
      action: 'auth.email_verified',
      actorUserId: user.id,
      ...meta,
      meta: { via: 'link', wasVerified },
    });
  }

  @Transactional('access')
  private async issueResend(userId: string, meta: RequestMeta): Promise<ResendResult> {
    const user = await this.store.users.lockById(userId);
    if (!user || user.status !== 'active') throw new AccessError('not_found', 'Không tìm thấy người dùng');
    if (user.emailVerifiedAt) return 'already_verified';
    await this.issueInCurrentTransaction(user, 'resend', meta);
    return 'sent';
  }
}
