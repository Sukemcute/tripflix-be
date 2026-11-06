import { Inject, Injectable } from '@nestjs/common';
import { randomInt, randomUUID } from 'node:crypto';
import type { AuthUser, SidBlocklist } from '@tripflix/auth';
import type {
  AccessUserGuestMergedV1,
  AccessRegistrationAttemptedExistingV1,
  AccessRegistrationCodeRequestedV1,
  AccessUserRegisteredV1,
  AccessUserWelcomeEmailRequestedV1,
} from '@tripflix/contracts';
import { Transactional } from '@tripflix/db';
import type { CoreEnv } from '../../../../platform/env.js';
import { CORE_ENV } from '../../../../platform/tokens.js';
import {
  DEFAULT_REGISTER_MAX_PER_IP,
  REGISTER_WINDOW_SECONDS,
  TOO_MANY_SIGNUPS_MESSAGE,
} from '../../account/domain/email-verification.js';
import {
  EMAIL_TAKEN_MESSAGE,
  GOOGLE_LOGIN_FAILED_MESSAGE,
  INVALID_CREDENTIALS_MESSAGE,
  INVALID_REFRESH_MESSAGE,
  SESSION_REVOKED_MESSAGE,
  TOO_MANY_ATTEMPTS_MESSAGE,
  buildDisplayName,
  normalizeEmail,
} from '../domain/credentials.js';
import { AccessError } from '../domain/errors.js';
import {
  INVALID_REGISTRATION_CODE,
  REGISTRATION_CODE_COOLDOWN_MESSAGE,
  REGISTRATION_CODE_COOLDOWN_SECONDS,
  REGISTRATION_CODE_TTL_MS,
} from '../domain/registration.js';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TTL_MS,
  decideRefresh,
  type RefreshDecision,
} from '../domain/refresh-rotation.js';
import {
  ACCESS_SID_BLOCKLIST,
  ACCESS_STORE,
  ACTION_RATE_LIMITER,
  CLOCK,
  GOOGLE_VERIFIER,
  LOGIN_RATE_LIMITER,
  PASSWORD_HASHER,
  TOKEN_ISSUER,
  type AccessStore,
  type ActionRateLimiter,
  type Clock,
  type GoogleIdentity,
  type GoogleIdTokenVerifier,
  type LoginRateLimiter,
  type PasswordHasher,
  type RequestMeta,
  type SessionRecord,
  type TokenIssuer,
  type UserRecord,
} from './ports.js';
import { mapMyProfile, mapPublicUser, type MyProfile, type PublicUser } from './public-user.js';
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
  private readonly registerMaxPerIp: number;

  constructor(
    @Inject(ACCESS_STORE) private readonly store: AccessStore,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    @Inject(TOKEN_ISSUER) private readonly tokens: TokenIssuer,
    @Inject(LOGIN_RATE_LIMITER) private readonly limiter: LoginRateLimiter,
    @Inject(ACCESS_SID_BLOCKLIST) private readonly blocklist: SidBlocklist,
    @Inject(CLOCK) private readonly now: Clock,
    @Inject(GOOGLE_VERIFIER) private readonly google: GoogleIdTokenVerifier,
    @Inject(ACTION_RATE_LIMITER) private readonly actionLimiter: ActionRateLimiter,
    @Inject(CORE_ENV) env: CoreEnv,
  ) {
    // E2E dựng env tay có thể thiếu biến này: dùng mặc định như khi parse env.
    this.registerMaxPerIp = (env.AUTH_REGISTER_MAX_PER_IP_HOUR as number | undefined) ?? DEFAULT_REGISTER_MAX_PER_IP;
  }

  async requestRegistrationCode(address: string, meta: RequestMeta): Promise<string> {
    const email = normalizeEmail(address);
    // Đợi giữa hai lần xin mã: kiểm trước để lần bấm quá sớm không ăn vào hạn mức theo giờ.
    const cooldown = await this.actionLimiter.consume(`register:cooldown:${email}`, 1, REGISTRATION_CODE_COOLDOWN_SECONDS);
    if (cooldown.isBlocked) {
      throw new AccessError('too_many_attempts', REGISTRATION_CODE_COOLDOWN_MESSAGE, cooldown.retryAfterSeconds);
    }
    await this.checkRegistrationLimit(
      [`register:ip:${meta.ip}`, this.registerMaxPerIp, REGISTER_WINDOW_SECONDS],
      [`register:email:${email}`, 3, REGISTER_WINDOW_SECONDS],
    );
    const id = randomUUID();
    // Băm cả khi email đã có tài khoản để thời gian trả lời như nhau, không dò được email nào đã đăng ký.
    const code = String(randomInt(100_000_000)).padStart(8, '0');
    const codeHash = await this.hasher.hash(code);
    const existing = await this.store.users.findByEmail(email);
    if (existing) {
      if (existing.status === 'active') await this.notifyExistingAccount(existing);
      return id;
    }

    await this.saveRegistrationCode(email, id, code, codeHash);
    return id;
  }

  /** API vẫn trả như email mới; chủ email nhận thư báo đã có tài khoản và cách đăng nhập. */
  @Transactional('access')
  private async notifyExistingAccount(user: UserRecord): Promise<void> {
    const payload: AccessRegistrationAttemptedExistingV1 = {
      userId: user.id,
      email: user.email,
      displayName: user.displayName,
      hasPassword: user.passwordHash !== null,
    };
    await this.store.outbox.add({ type: 'access.registration_attempted_existing', userId: user.id, payload });
  }

  @Transactional('access')
  private async saveRegistrationCode(email: string, id: string, code: string, codeHash: string): Promise<void> {
    const expiresAt = new Date(this.now().getTime() + REGISTRATION_CODE_TTL_MS);
    await this.store.registrationChallenges.save({ email, id, codeHash, expiresAt });
    const payload: AccessRegistrationCodeRequestedV1 = { email, code, expiresAt: expiresAt.toISOString() };
    await this.store.outbox.add({ type: 'access.registration_code_requested', userId: id, payload });
  }

  async register(input: { email: string; password: string; displayName: string; registrationId: string; code: string }, meta: RequestMeta): Promise<PublicUser> {
    const email = normalizeEmail(input.email);
    await this.checkRegistrationLimit(
      [`register-code:ip:${meta.ip}`, 30, 600],
      [`register-code:id:${input.registrationId}`, 5, 600],
    );
    const challenge = await this.store.registrationChallenges.findUsable(email, input.registrationId, this.now());
    if (!challenge || !(await this.hasher.verify(challenge.codeHash, input.code))) {
      throw new AccessError('invalid_registration_code', INVALID_REGISTRATION_CODE);
    }
    const passwordHash = await this.hasher.hash(input.password);
    const user = await this.createVerifiedMember(
      { email, passwordHash, displayName: input.displayName.trim(), registrationId: input.registrationId },
      meta,
    );
    return mapPublicUser(user);
  }

  private async checkRegistrationLimit(...keys: [key: string, max: number, seconds: number][]): Promise<void> {
    const results = await Promise.all(keys.map(([key, max, seconds]) => this.actionLimiter.consume(key, max, seconds)));
    const blocked = results.find((result) => result.isBlocked);
    if (blocked) throw new AccessError('too_many_attempts', TOO_MANY_SIGNUPS_MESSAGE, blocked.retryAfterSeconds);
  }

  async login(
    input: { email: string; password: string; deviceName?: string | undefined },
    meta: RequestMeta,
  ): Promise<TokenPair> {
    const email = normalizeEmail(input.email);
    const limit = await this.limiter.check(email, meta.ip);
    if (limit.isBlocked) throw new AccessError('too_many_attempts', TOO_MANY_ATTEMPTS_MESSAGE, limit.retryAfterSeconds);

    const user = await this.store.users.findByEmail(email);
    // Email không tồn tại hoặc tài khoản chỉ có Google (chưa đặt mật khẩu) vẫn chạy argon2,
    // để thời gian phản hồi không lộ email nào có tài khoản.
    const isPasswordValid = user?.passwordHash
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

  /**
   * Đăng nhập bằng Google ID token. Đã liên kết: vào đúng tài khoản đó. Chưa liên kết nhưng trùng email (Google đã
   * xác minh): liên kết vào tài khoản đó. Chưa có tài khoản: tạo member không có mật khẩu. Bị khoá: 401.
   */
  async loginWithGoogle(input: { idToken: string; deviceName?: string | undefined }, meta: RequestMeta): Promise<TokenPair> {
    const identity = await this.google.verify(input.idToken);
    const { user, revokedSids } = await this.resolveGoogleUser(identity, meta);
    await Promise.all(revokedSids.map((sid) => this.blocklist.block(sid, ACCESS_TOKEN_TTL_SECONDS)));
    if (user.status !== 'active') {
      await this.store.audit.record({ action: 'auth.login_failed', actorUserId: user.id, ...meta, meta: { provider: 'google' } });
      throw new AccessError('google_invalid', GOOGLE_LOGIN_FAILED_MESSAGE);
    }
    const refreshToken = createRefreshToken();
    const session = await this.openSession(user, hashRefreshToken(refreshToken), input.deviceName ?? null, meta, 'google');
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

  async getMe(userId: string): Promise<MyProfile> {
    const user = await this.store.users.findById(userId);
    if (!user) throw new AccessError('not_found', 'Không tìm thấy người dùng');
    return mapMyProfile(user);
  }

  /** Tiêu mã và tạo tài khoản trong cùng transaction. */
  @Transactional('access')
  private async createVerifiedMember(
    input: { email: string; passwordHash: string; displayName: string; registrationId: string },
    meta: RequestMeta,
  ): Promise<UserRecord> {
    const { registrationId, ...credentials } = input;
    if (!(await this.store.registrationChallenges.consume(input.email, registrationId, this.now()))) {
      throw new AccessError('invalid_registration_code', INVALID_REGISTRATION_CODE);
    }
    const created = await this.insertMember(credentials, meta, 'password');
    if (!created) throw new AccessError('email_taken', EMAIL_TAKEN_MESSAGE);
    await this.addGuestMerged(created.id, meta);
    return created;
  }

  /**
   * Thêm member, phát access.user.registered và yêu cầu gửi email; gọi trong transaction đang mở,
   * nên tài khoản không tạo được (email trùng, rollback) thì không có email.
   * Chỉ gọi sau khi xác thực email bằng mã đăng ký hoặc danh tính Google.
   */
  private async insertMember(
    input: { email: string; passwordHash: string | null; displayName: string },
    meta: RequestMeta,
    provider: 'password' | 'google',
  ): Promise<UserRecord | null> {
    const created = await this.store.users.insert({
      ...input,
      role: 'member',
      emailVerifiedAt: this.now(),
    });
    if (!created) return null;
    await this.store.audit.record({ action: 'auth.register', actorUserId: created.id, ...meta, meta: { provider } });
    const payload: AccessUserRegisteredV1 = { userId: created.id, displayName: created.displayName };
    await this.store.outbox.add({ type: 'access.user.registered', userId: created.id, payload });
    const welcome: AccessUserWelcomeEmailRequestedV1 = {
      userId: created.id,
      email: created.email,
      displayName: created.displayName,
      provider,
    };
    await this.store.outbox.add({ type: 'access.user.welcome_email_requested', userId: created.id, payload: welcome });
    return created;
  }

  /**
   * Tìm hoặc tạo tài khoản cho danh tính Google; không liên kết vào tài khoản đang bị khoá. Google đã xác minh
   * email, nên tài khoản đi qua đây được đánh dấu đã xác thực (TF05D).
   *
   * Liên kết vào tài khoản mật khẩu CHƯA xác thực: mật khẩu đó có thể do người khác đặt trước bằng email của
   * chủ thật (chiếm tài khoản trước, pre-account hijacking). Khi đó xoá mật khẩu và mọi phiên cũ; chủ thật
   * muốn dùng mật khẩu thì đặt lại qua email.
   */
  @Transactional('access')
  private async resolveGoogleUser(
    identity: GoogleIdentity,
    meta: RequestMeta,
  ): Promise<{ user: UserRecord; revokedSids: string[] }> {
    const linkedUserId = await this.store.identities.findUserId('google', identity.subject);
    if (linkedUserId) {
      const linked = await this.store.users.findById(linkedUserId);
      if (linked) return { user: await this.ensureVerified(linked, meta), revokedSids: [] };
    }
    const email = normalizeEmail(identity.email);
    const link = { provider: 'google' as const, subject: identity.subject, email };
    const existing = await this.store.users.findByEmail(email);
    if (existing) {
      if (existing.status !== 'active') return { user: existing, revokedSids: [] };
      await this.linkIdentity({ ...link, userId: existing.id });
      const isTakeoverRisk = existing.emailVerifiedAt === null && existing.passwordHash !== null;
      const revokedSids = isTakeoverRisk ? await this.store.sessions.deleteByUser(existing.id) : [];
      if (isTakeoverRisk) await this.store.users.updatePasswordHash(existing.id, null);
      await this.store.audit.record({
        action: 'auth.google_linked',
        actorUserId: existing.id,
        ...meta,
        meta: { email, ...(isTakeoverRisk ? { clearedUnverifiedPassword: true, revokedSessions: revokedSids.length } : {}) },
      });
      const current = (await this.store.users.findById(existing.id)) ?? existing;
      return { user: await this.ensureVerified(current, meta), revokedSids };
    }
    const created = await this.insertMember({ email, passwordHash: null, displayName: buildDisplayName(identity.name, email) }, meta, 'google');
    // Request khác vừa tạo cùng email: lỗi để client thử lại, lần sau sẽ vào nhánh liên kết ở trên.
    if (!created) throw new AccessError('google_invalid', GOOGLE_LOGIN_FAILED_MESSAGE);
    await this.linkIdentity({ ...link, userId: created.id });
    return { user: created, revokedSids: [] };
  }

  /** Gọi trong transaction đang mở: đăng nhập bằng Google chứng minh sở hữu email, đánh dấu đã xác thực nếu chưa. */
  private async ensureVerified(user: UserRecord, meta: RequestMeta): Promise<UserRecord> {
    if (user.emailVerifiedAt) return user;
    const verified = (await this.store.users.markEmailVerified(user.id, this.now())) ?? user;
    await this.store.audit.record({ action: 'auth.email_verified', actorUserId: user.id, ...meta, meta: { via: 'google' } });
    return verified;
  }

  /** Hai request đăng nhập Google lần đầu cùng lúc: request thua thì ném lỗi để transaction của nó rollback. */
  private async linkIdentity(identity: { provider: 'google'; subject: string; userId: string; email: string }): Promise<void> {
    if (!(await this.store.identities.insert(identity))) throw new AccessError('google_invalid', GOOGLE_LOGIN_FAILED_MESSAGE);
  }

  /** Mở phiên đăng nhập; có X-Anon-Id thì phát access.user.guest_merged trong cùng transaction. */
  @Transactional('access')
  private async openSession(
    user: UserRecord,
    refreshTokenHash: string,
    deviceName: string | null,
    meta: RequestMeta,
    provider: 'password' | 'google' = 'password',
  ): Promise<SessionRecord> {
    const created = await this.store.sessions.insert({
      userId: user.id,
      refreshTokenHash,
      expiresAt: new Date(this.now().getTime() + REFRESH_TTL_MS),
      deviceName,
      userAgent: meta.userAgent,
      ip: meta.ip,
    });
    await this.store.audit.record({ action: 'auth.login', actorUserId: user.id, ...meta, meta: { sid: created.id, provider } });
    await this.addGuestMerged(user.id, meta);
    return created;
  }

  /** Gọi trong transaction đang mở: đăng ký hoặc đăng nhập thành công mới có sự kiện. */
  private async addGuestMerged(userId: string, meta: RequestMeta): Promise<void> {
    if (!meta.anonId) return;
    const payload: AccessUserGuestMergedV1 = { anonId: meta.anonId, userId };
    await this.store.outbox.add({ type: 'access.user.guest_merged', userId, payload });
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
    const access = await this.tokens.issue({ userId: user.id, role: user.role, sid, emailVerified: user.emailVerifiedAt !== null });
    return { accessToken: access.token, refreshToken, tokenType: 'Bearer', expiresIn: access.expiresIn };
  }

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= this.hasher.hash('tripflix-dummy-password-for-timing');
    return this.dummyHash;
  }
}
