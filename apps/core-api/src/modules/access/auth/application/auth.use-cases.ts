import { Inject, Injectable } from '@nestjs/common';
import type { AuthUser, SidBlocklist } from '@tripflix/auth';
import type { AccessUserRegisteredV1 } from '@tripflix/contracts';
import {
  EMAIL_TAKEN_MESSAGE,
  INVALID_CREDENTIALS_MESSAGE,
  INVALID_REFRESH_MESSAGE,
  SESSION_REVOKED_MESSAGE,
  TOO_MANY_ATTEMPTS_MESSAGE,
  normalizeEmail,
} from '../domain/credentials.js';
import { AccessError } from '../domain/errors.js';
import { ACCESS_TOKEN_TTL_SECONDS, REFRESH_TTL_MS, decideRefresh } from '../domain/refresh-rotation.js';
import {
  ACCESS_SID_BLOCKLIST,
  ACCESS_STORE,
  CLOCK,
  LOGIN_RATE_LIMITER,
  PASSWORD_HASHER,
  TOKEN_ISSUER,
  type AccessStore,
  type Clock,
  type LoginRateLimiter,
  type PasswordHasher,
  type RequestMeta,
  type TokenIssuer,
  type UserRecord,
} from './ports.js';
import { mapPublicUser, type PublicUser } from './public-user.js';
import { hashRefreshToken, createRefreshToken } from './refresh-token.js';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
}

/**
 * Use case đăng ký, đăng nhập, làm mới, đăng xuất. Ghi database và audit_logs trong cùng transaction;
 * Redis (chặn sid, đếm đăng nhập sai) ghi sau khi commit, không nằm trong transaction.
 */
@Injectable()
export class AuthUseCases {
  private dummyHash?: Promise<string>;

  constructor(
    @Inject(ACCESS_STORE) private readonly store: AccessStore,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    @Inject(TOKEN_ISSUER) private readonly tokens: TokenIssuer,
    @Inject(LOGIN_RATE_LIMITER) private readonly limiter: LoginRateLimiter,
    @Inject(ACCESS_SID_BLOCKLIST) private readonly blocklist: SidBlocklist,
    @Inject(CLOCK) private readonly now: Clock,
  ) {}

  async register(input: { email: string; password: string; displayName: string }, meta: RequestMeta): Promise<PublicUser> {
    const email = normalizeEmail(input.email);
    const passwordHash = await this.hasher.hash(input.password);
    const user = await this.store.transaction(async (tx) => {
      // Đăng ký công khai luôn là member; nhân viên do superadmin cấp.
      const created = await tx.users.insert({ email, passwordHash, displayName: input.displayName.trim(), role: 'member' });
      if (!created) return null;
      await tx.audit.record({ action: 'auth.register', actorUserId: created.id, ...meta });
      const payload: AccessUserRegisteredV1 = { userId: created.id, displayName: created.displayName };
      await tx.outbox.add({ type: 'access.user.registered', userId: created.id, payload });
      return created;
    });
    if (!user) throw new AccessError('email_taken', EMAIL_TAKEN_MESSAGE);
    return mapPublicUser(user);
  }

  async login(
    input: { email: string; password: string; deviceName?: string | undefined },
    meta: RequestMeta,
  ): Promise<TokenPair> {
    const email = normalizeEmail(input.email);
    const limit = await this.limiter.check(email, meta.ip);
    if (limit.isBlocked) throw new AccessError('too_many_attempts', TOO_MANY_ATTEMPTS_MESSAGE, limit.retryAfterSeconds);

    const user = await this.store.users.findByEmail(email);
    // Email không tồn tại vẫn chạy argon2 để thời gian phản hồi không lộ email nào có tài khoản.
    const isPasswordValid = user
      ? await this.hasher.verify(user.passwordHash, input.password)
      : await this.hasher.verify(await this.getDummyHash(), input.password).then(() => false);

    if (!user || !isPasswordValid || user.status !== 'active') {
      await this.limiter.recordFailure(email, meta.ip);
      await this.store.audit.record({
        action: 'auth.login_failed',
        actorUserId: user?.id ?? null,
        ...meta,
        meta: { email },
      });
      throw new AccessError('invalid_credentials', INVALID_CREDENTIALS_MESSAGE);
    }

    await this.limiter.reset(email);
    const refreshToken = createRefreshToken();
    const session = await this.store.transaction(async (tx) => {
      const created = await tx.sessions.insert({
        userId: user.id,
        refreshTokenHash: hashRefreshToken(refreshToken),
        expiresAt: new Date(this.now().getTime() + REFRESH_TTL_MS),
        deviceName: input.deviceName ?? null,
        userAgent: meta.userAgent,
        ip: meta.ip,
      });
      await tx.audit.record({ action: 'auth.login', actorUserId: user.id, ...meta, meta: { sid: created.id } });
      return created;
    });
    return this.issueTokenPair(user, session.id, refreshToken);
  }

  async refresh(refreshToken: string, meta: RequestMeta): Promise<TokenPair> {
    const presented = hashRefreshToken(refreshToken);
    const session = await this.store.sessions.findByTokenHash(presented);
    if (!session) throw new AccessError('invalid_refresh', INVALID_REFRESH_MESSAGE);

    const now = this.now();
    const decision = decideRefresh(session, presented, now);
    if (decision === 'invalid') throw new AccessError('invalid_refresh', INVALID_REFRESH_MESSAGE);

    if (decision === 'reuse') {
      await this.store.transaction(async (tx) => {
        await tx.sessions.delete(session.id);
        await tx.audit.record({ action: 'auth.refresh_reused', actorUserId: session.userId, ...meta, meta: { sid: session.id } });
      });
      await this.blocklist.block(session.id, ACCESS_TOKEN_TTL_SECONDS);
      throw new AccessError('session_revoked', SESSION_REVOKED_MESSAGE);
    }

    const user = await this.store.users.findById(session.userId);
    if (!user || user.status !== 'active') throw new AccessError('invalid_refresh', INVALID_REFRESH_MESSAGE);

    const next = createRefreshToken();
    const nextHash = hashRefreshToken(next);
    const expiresAt = new Date(now.getTime() + REFRESH_TTL_MS);
    const hasRotated = await this.store.transaction(async (tx) => {
      // grace: giữ nguyên token liền trước và mốc xoay, để khoảng 10 giây không bị kéo dài.
      const hasUpdated =
        decision === 'rotate'
          ? await tx.sessions.rotate(session.id, presented, {
              refreshTokenHash: nextHash,
              previousTokenHash: presented,
              rotatedAt: now,
              expiresAt,
              lastUsedAt: now,
            })
          : await tx.sessions.rotate(session.id, session.refreshTokenHash, {
              refreshTokenHash: nextHash,
              previousTokenHash: session.previousTokenHash,
              rotatedAt: session.rotatedAt,
              expiresAt,
              lastUsedAt: now,
            });
      if (hasUpdated) {
        await tx.audit.record({ action: 'auth.refresh', actorUserId: user.id, ...meta, meta: { sid: session.id, decision } });
      }
      return hasUpdated;
    });
    if (!hasRotated) throw new AccessError('invalid_refresh', INVALID_REFRESH_MESSAGE);
    return this.issueTokenPair(user, session.id, next);
  }

  async logout(user: AuthUser, meta: RequestMeta): Promise<void> {
    await this.store.transaction(async (tx) => {
      await tx.sessions.delete(user.sid);
      await tx.audit.record({ action: 'auth.logout', actorUserId: user.userId, ...meta, meta: { sid: user.sid } });
    });
    // Chặn sid tới khi access token hiện tại hết hạn, để token cũ bị từ chối ngay.
    const remaining = user.exp - Math.floor(this.now().getTime() / 1000);
    await this.blocklist.block(user.sid, Math.max(remaining, 1));
  }

  async getMe(userId: string): Promise<PublicUser> {
    const user = await this.store.users.findById(userId);
    if (!user) throw new AccessError('not_found', 'Không tìm thấy người dùng');
    return mapPublicUser(user);
  }

  private async issueTokenPair(user: UserRecord, sid: string, refreshToken: string): Promise<TokenPair> {
    const access = await this.tokens.issue({ userId: user.id, role: user.role, sid });
    return { accessToken: access.token, refreshToken, tokenType: 'Bearer', expiresIn: access.expiresIn };
  }

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= this.hasher.hash('tripflix-dummy-password-for-timing');
    return this.dummyHash;
  }
}
