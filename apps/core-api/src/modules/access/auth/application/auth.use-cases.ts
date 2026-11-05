import { Inject, Injectable } from '@nestjs/common';
import type { AuthUser, SidBlocklist } from '@tripflix/auth';
import type { AccessUserRegisteredV1 } from '@tripflix/contracts';
import { Transactional } from '@tripflix/db';
import {
  EMAIL_TAKEN_MESSAGE,
  INVALID_CREDENTIALS_MESSAGE,
  INVALID_REFRESH_MESSAGE,
  SESSION_REVOKED_MESSAGE,
  TOO_MANY_ATTEMPTS_MESSAGE,
  normalizeEmail,
} from '../domain/credentials.js';
import { AccessError } from '../domain/errors.js';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TTL_MS,
  decideRefresh,
  type RefreshDecision,
} from '../domain/refresh-rotation.js';
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
  type SessionRecord,
  type TokenIssuer,
  type UserRecord,
} from './ports.js';
import { mapPublicUser, type PublicUser } from './public-user.js';
import { createRefreshToken, hashRefreshToken } from './refresh-token.js';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
}

/**
 * Use case đăng ký, đăng nhập, làm mới, đăng xuất.
 * Chỉ các bước ghi database (cùng audit_logs, outbox) nằm trong @Transactional('access'); băm argon2,
 * Redis (chặn sid, đếm đăng nhập sai) và ký token chạy ngoài transaction để không giữ khoá lâu.
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
    const user = await this.createMember({ email, passwordHash, displayName: input.displayName.trim() }, meta);
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
    const session = await this.openSession(user, hashRefreshToken(refreshToken), input.deviceName ?? null, meta);
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
      await this.revokeReusedSession(session, meta);
      await this.blocklist.block(session.id, ACCESS_TOKEN_TTL_SECONDS);
      throw new AccessError('session_revoked', SESSION_REVOKED_MESSAGE);
    }

    const user = await this.store.users.findById(session.userId);
    if (!user || user.status !== 'active') throw new AccessError('invalid_refresh', INVALID_REFRESH_MESSAGE);

    const next = createRefreshToken();
    const hasRotated = await this.rotateSession(session, { presented, nextHash: hashRefreshToken(next), decision, now }, meta);
    if (!hasRotated) throw new AccessError('invalid_refresh', INVALID_REFRESH_MESSAGE);
    return this.issueTokenPair(user, session.id, next);
  }

  async logout(user: AuthUser, meta: RequestMeta): Promise<void> {
    await this.closeSession(user, meta);
    // Chặn sid tới khi access token hiện tại hết hạn, để token cũ bị từ chối ngay.
    const remaining = user.exp - Math.floor(this.now().getTime() / 1000);
    await this.blocklist.block(user.sid, Math.max(remaining, 1));
  }

  async getMe(userId: string): Promise<PublicUser> {
    const user = await this.store.users.findById(userId);
    if (!user) throw new AccessError('not_found', 'Không tìm thấy người dùng');
    return mapPublicUser(user);
  }

  /** Đăng ký công khai luôn là member; nhân viên do superadmin cấp. Trả null khi email đã có. */
  @Transactional('access')
  private async createMember(
    input: { email: string; passwordHash: string; displayName: string },
    meta: RequestMeta,
  ): Promise<UserRecord | null> {
    const created = await this.store.users.insert({ ...input, role: 'member' });
    if (!created) return null;
    await this.store.audit.record({ action: 'auth.register', actorUserId: created.id, ...meta });
    const payload: AccessUserRegisteredV1 = { userId: created.id, displayName: created.displayName };
    await this.store.outbox.add({ type: 'access.user.registered', userId: created.id, payload });
    return created;
  }

  @Transactional('access')
  private async openSession(
    user: UserRecord,
    refreshTokenHash: string,
    deviceName: string | null,
    meta: RequestMeta,
  ): Promise<SessionRecord> {
    const created = await this.store.sessions.insert({
      userId: user.id,
      refreshTokenHash,
      expiresAt: new Date(this.now().getTime() + REFRESH_TTL_MS),
      deviceName,
      userAgent: meta.userAgent,
      ip: meta.ip,
    });
    await this.store.audit.record({ action: 'auth.login', actorUserId: user.id, ...meta, meta: { sid: created.id } });
    return created;
  }

  @Transactional('access')
  private async revokeReusedSession(session: SessionRecord, meta: RequestMeta): Promise<void> {
    await this.store.sessions.delete(session.id);
    await this.store.audit.record({
      action: 'auth.refresh_reused',
      actorUserId: session.userId,
      ...meta,
      meta: { sid: session.id },
    });
  }

  /** Cập nhật có điều kiện: trả false khi request khác đã xoay trước. */
  @Transactional('access')
  private async rotateSession(
    session: SessionRecord,
    rotation: { presented: string; nextHash: string; decision: Exclude<RefreshDecision, 'invalid' | 'reuse'>; now: Date },
    meta: RequestMeta,
  ): Promise<boolean> {
    const { presented, nextHash, decision, now } = rotation;
    const expiresAt = new Date(now.getTime() + REFRESH_TTL_MS);
    // grace: giữ nguyên token liền trước và mốc xoay, để khoảng 10 giây không bị kéo dài.
    const hasUpdated =
      decision === 'rotate'
        ? await this.store.sessions.rotate(session.id, presented, {
            refreshTokenHash: nextHash,
            previousTokenHash: presented,
            rotatedAt: now,
            expiresAt,
            lastUsedAt: now,
          })
        : await this.store.sessions.rotate(session.id, session.refreshTokenHash, {
            refreshTokenHash: nextHash,
            previousTokenHash: session.previousTokenHash,
            rotatedAt: session.rotatedAt,
            expiresAt,
            lastUsedAt: now,
          });
    if (hasUpdated) {
      await this.store.audit.record({
        action: 'auth.refresh',
        actorUserId: session.userId,
        ...meta,
        meta: { sid: session.id, decision },
      });
    }
    return hasUpdated;
  }

  @Transactional('access')
  private async closeSession(user: AuthUser, meta: RequestMeta): Promise<void> {
    await this.store.sessions.delete(user.sid);
    await this.store.audit.record({ action: 'auth.logout', actorUserId: user.userId, ...meta, meta: { sid: user.sid } });
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
