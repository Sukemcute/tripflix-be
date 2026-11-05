import { Inject, Injectable } from '@nestjs/common';
import type { SidBlocklist } from '@tripflix/auth';
import type { AccessPasswordResetRequestedV1 } from '@tripflix/contracts';
import { Transactional } from '@tripflix/db';
import { DEFAULT_PASSWORD_RESET_URL, type CoreEnv } from '../../../../platform/env.js';
import { CORE_ENV } from '../../../../platform/tokens.js';
import {
  ACCESS_SID_BLOCKLIST,
  ACCESS_STORE,
  ACTION_RATE_LIMITER,
  CLOCK,
  LOGIN_RATE_LIMITER,
  PASSWORD_HASHER,
  type AccessStore,
  type ActionRateLimiter,
  type Clock,
  type LoginRateLimiter,
  type PasswordHasher,
  type RequestMeta,
  type UserRecord,
} from '../../auth/application/ports.js';
import { createRefreshToken, hashRefreshToken } from '../../auth/application/refresh-token.js';
import { normalizeEmail } from '../../auth/domain/credentials.js';
import { AccessError } from '../../auth/domain/errors.js';
import { ACCESS_TOKEN_TTL_SECONDS } from '../../auth/domain/refresh-rotation.js';
import {
  FORGOT_MAX_PER_EMAIL,
  FORGOT_MAX_PER_IP,
  FORGOT_WINDOW_SECONDS,
  INVALID_RESET_TOKEN_MESSAGE,
  PASSWORD_RESET_TTL_MS,
  TOO_MANY_RESET_REQUESTS_MESSAGE,
  buildResetUrl,
} from '../domain/password-reset.js';

/**
 * Quên và đặt lại mật khẩu. Email do notification-service gửi khi nhận access.password_reset_requested
 * (ghi outbox trong cùng transaction với token). Token 256 bit ngẫu nhiên, database chỉ giữ SHA-256.
 */
@Injectable()
export class PasswordResetUseCases {
  private readonly resetPageUrl: string;

  constructor(
    @Inject(ACCESS_STORE) private readonly store: AccessStore,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    @Inject(ACTION_RATE_LIMITER) private readonly actionLimiter: ActionRateLimiter,
    @Inject(LOGIN_RATE_LIMITER) private readonly loginLimiter: LoginRateLimiter,
    @Inject(ACCESS_SID_BLOCKLIST) private readonly blocklist: SidBlocklist,
    @Inject(CLOCK) private readonly now: Clock,
    @Inject(CORE_ENV) env: CoreEnv,
  ) {
    // E2E cũ dựng env tay có thể thiếu biến này: dùng mặc định như khi parse env.
    this.resetPageUrl = (env.AUTH_PASSWORD_RESET_URL as string | undefined) ?? DEFAULT_PASSWORD_RESET_URL;
  }

  /**
   * Luôn kết thúc như nhau với email có hay không có tài khoản (controller trả 202 cùng một câu).
   * Giới hạn đếm trước khi tra email, nên 429 cũng không lộ email nào có tài khoản.
   */
  async requestReset(input: { email: string }, meta: RequestMeta): Promise<void> {
    const email = normalizeEmail(input.email);
    const [byEmail, byIp] = await Promise.all([
      this.actionLimiter.consume(`forgot:email:${email}`, FORGOT_MAX_PER_EMAIL, FORGOT_WINDOW_SECONDS),
      this.actionLimiter.consume(`forgot:ip:${meta.ip}`, FORGOT_MAX_PER_IP, FORGOT_WINDOW_SECONDS),
    ]);
    const blocked = [byEmail, byIp].find((s) => s.isBlocked);
    if (blocked) throw new AccessError('too_many_attempts', TOO_MANY_RESET_REQUESTS_MESSAGE, blocked.retryAfterSeconds);

    const user = await this.store.users.findByEmail(email);
    if (!user || user.status !== 'active') return;
    await this.issueResetToken(user, meta);
  }

  /** Token đúng, chưa dùng, chưa hết hạn: đổi mật khẩu, đánh dấu đã dùng, thu hồi mọi phiên. Sai: 400 cùng một câu. */
  async resetPassword(input: { token: string; newPassword: string }, meta: RequestMeta): Promise<void> {
    const tokenHash = hashRefreshToken(input.token);
    // Kiểm trước khi băm argon2 để token rác không tốn CPU; bước consume trong transaction mới là bước quyết định.
    if (!(await this.store.passwordResets.findUsable(tokenHash, this.now()))) {
      throw new AccessError('invalid_reset_token', INVALID_RESET_TOKEN_MESSAGE);
    }
    const passwordHash = await this.hasher.hash(input.newPassword);
    const { user, revokedSids } = await this.applyReset(tokenHash, passwordHash, meta);
    await this.loginLimiter.reset(user.email);
    await Promise.all(revokedSids.map((sid) => this.blocklist.block(sid, ACCESS_TOKEN_TTL_SECONDS)));
  }

  @Transactional('access')
  private async issueResetToken(user: UserRecord, meta: RequestMeta): Promise<void> {
    const token = createRefreshToken();
    const expiresAt = new Date(this.now().getTime() + PASSWORD_RESET_TTL_MS);
    // Mỗi lúc chỉ một link còn hiệu lực: yêu cầu mới làm link cũ hết dùng được.
    const replaced = await this.store.passwordResets.deleteUnusedByUser(user.id);
    await this.store.passwordResets.insert({ userId: user.id, tokenHash: hashRefreshToken(token), expiresAt });
    await this.store.audit.record({
      action: 'auth.password_reset_requested',
      actorUserId: user.id,
      ...meta,
      meta: { replacedTokens: replaced, expiresAt: expiresAt.toISOString() },
    });
    // Link có token gốc nằm trong outbox, stream để notification-service gửi email. Dòng outbox bị job dọn xoá
    // sau 7 ngày; token đã hết hạn từ lâu trước đó (30 phút).
    const payload: AccessPasswordResetRequestedV1 = {
      userId: user.id,
      email: user.email,
      displayName: user.displayName,
      resetUrl: buildResetUrl(this.resetPageUrl, token),
      expiresAt: expiresAt.toISOString(),
    };
    await this.store.outbox.add({ type: 'access.password_reset_requested', userId: user.id, payload });
  }

  @Transactional('access')
  private async applyReset(
    tokenHash: string,
    passwordHash: string,
    meta: RequestMeta,
  ): Promise<{ user: UserRecord; revokedSids: string[] }> {
    const consumed = await this.store.passwordResets.consume(tokenHash, this.now());
    if (!consumed) throw new AccessError('invalid_reset_token', INVALID_RESET_TOKEN_MESSAGE);
    const user = await this.store.users.findById(consumed.userId);
    // Bị khoá sau khi xin link: không cho đổi mật khẩu. Ném lỗi thì transaction rollback, token chưa bị tiêu.
    if (!user || user.status !== 'active') throw new AccessError('invalid_reset_token', INVALID_RESET_TOKEN_MESSAGE);
    await this.store.users.updatePasswordHash(user.id, passwordHash);
    const revokedSids = await this.store.sessions.deleteByUser(user.id);
    await this.store.audit.record({
      action: 'auth.password_reset',
      actorUserId: user.id,
      ...meta,
      meta: { revokedSessions: revokedSids.length },
    });
    return { user, revokedSids };
  }
}
