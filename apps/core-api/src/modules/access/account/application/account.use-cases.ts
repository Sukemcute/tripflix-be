import { Inject, Injectable } from '@nestjs/common';
import type { AuthUser, SidBlocklist } from '@tripflix/auth';
import type { AccessUserProfileUpdatedV1 } from '@tripflix/contracts';
import { Transactional } from '@tripflix/db';
import {
  ACCESS_SID_BLOCKLIST,
  ACCESS_STORE,
  CLOCK,
  LOGIN_RATE_LIMITER,
  PASSWORD_HASHER,
  type AccessStore,
  type Clock,
  type LoginRateLimiter,
  type PasswordHasher,
  type ProfilePatch,
  type RequestMeta,
  type UserRecord,
} from '../../auth/application/ports.js';
import { mapMyProfile, type MyProfile } from '../../auth/application/public-user.js';
import { TOO_MANY_ATTEMPTS_MESSAGE } from '../../auth/domain/credentials.js';
import { AccessError } from '../../auth/domain/errors.js';
import { ACCESS_TOKEN_TTL_SECONDS } from '../../auth/domain/refresh-rotation.js';

export const WRONG_CURRENT_PASSWORD_MESSAGE = 'Mật khẩu hiện tại không đúng';
export const SESSION_NOT_FOUND_MESSAGE = 'Không tìm thấy phiên đăng nhập';
const USER_NOT_FOUND_MESSAGE = 'Không tìm thấy người dùng';

/** Một thiết bị đang đăng nhập; isCurrent là phiên của access token đang gọi. */
export interface SessionView {
  id: string;
  deviceName: string | null;
  userAgent: string | null;
  createdAt: string;
  lastUsedAt: string;
  isCurrent: boolean;
}

/**
 * "Tài khoản của tôi": đổi tên, đổi mật khẩu, xem và thoát từng thiết bị.
 * Xoá phiên trong @Transactional('access'), sau commit mới chặn sid trong Redis để token cũ nhận 401 ngay.
 * Chặn đủ ACCESS_TOKEN_TTL_SECONDS vì không biết access token của phiên khác còn sống bao lâu.
 */
@Injectable()
export class AccountUseCases {
  constructor(
    @Inject(ACCESS_STORE) private readonly store: AccessStore,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    @Inject(LOGIN_RATE_LIMITER) private readonly limiter: LoginRateLimiter,
    @Inject(ACCESS_SID_BLOCKLIST) private readonly blocklist: SidBlocklist,
    @Inject(CLOCK) private readonly now: Clock,
  ) {}

  /** Chỉ ghi các trường thật sự đổi. Trả hồ sơ đầy đủ của chính mình (có thông tin cá nhân). */
  async updateProfile(actor: AuthUser, input: ProfilePatch, meta: RequestMeta): Promise<MyProfile> {
    return mapMyProfile(await this.applyProfileUpdate(actor.userId, input, meta));
  }

  /**
   * Sai mật khẩu hiện tại tính chung vào giới hạn đăng nhập sai của email đó, để ai cầm được access token
   * cũng không dò mật khẩu được. Đổi xong thì thu hồi mọi phiên khác, giữ phiên đang dùng.
   */
  async changePassword(
    actor: AuthUser,
    input: { currentPassword: string; newPassword: string },
    meta: RequestMeta,
  ): Promise<void> {
    const user = await this.loadUser(actor.userId);
    const limit = await this.limiter.check(user.email, meta.ip);
    if (limit.isBlocked) throw new AccessError('too_many_attempts', TOO_MANY_ATTEMPTS_MESSAGE, limit.retryAfterSeconds);

    // Tài khoản chỉ có Google chưa có mật khẩu: không đổi được ở đây, dùng "quên mật khẩu" để đặt mật khẩu đầu tiên.
    const isCurrentValid = user.passwordHash ? await this.hasher.verify(user.passwordHash, input.currentPassword) : false;
    if (!isCurrentValid) {
      await this.limiter.recordFailure(user.email, meta.ip);
      await this.store.audit.record({ action: 'auth.password_change_failed', actorUserId: user.id, ...meta });
      throw new AccessError('wrong_password', WRONG_CURRENT_PASSWORD_MESSAGE);
    }

    const passwordHash = await this.hasher.hash(input.newPassword);
    const revokedSids = await this.applyPasswordChange(user.id, passwordHash, actor.sid, meta);
    await this.limiter.reset(user.email);
    await this.blockSessions(revokedSids);
  }

  async listSessions(actor: AuthUser): Promise<SessionView[]> {
    const sessions = await this.store.sessions.listActiveByUser(actor.userId, this.now());
    return sessions.map((s) => ({
      id: s.id,
      deviceName: s.deviceName,
      userAgent: s.userAgent,
      createdAt: s.createdAt.toISOString(),
      lastUsedAt: s.lastUsedAt.toISOString(),
      isCurrent: s.id === actor.sid,
    }));
  }

  /** Thoát một thiết bị. Phiên của người khác trả 404 như phiên không tồn tại, để không lộ sid của ai. */
  async revokeSession(actor: AuthUser, sessionId: string, meta: RequestMeta): Promise<void> {
    const isDeleted = await this.applySessionRevoke(actor.userId, sessionId, meta);
    if (!isDeleted) throw new AccessError('not_found', SESSION_NOT_FOUND_MESSAGE);
    await this.blockSessions([sessionId]);
  }

  /** Thoát mọi thiết bị, kể cả thiết bị đang gọi. */
  async logoutAll(actor: AuthUser, meta: RequestMeta): Promise<void> {
    const revokedSids = await this.applyLogoutAll(actor.userId, meta);
    // Phiên hiện tại có thể đã bị xoá trước đó; vẫn chặn sid của token đang gọi.
    await this.blockSessions([...new Set([...revokedSids, actor.sid])]);
  }

  @Transactional('access')
  private async applyProfileUpdate(userId: string, input: ProfilePatch, meta: RequestMeta): Promise<UserRecord> {
    const before = await this.loadUser(userId);
    const current: Required<ProfilePatch> = { displayName: before.displayName, ...before.personal };
    const changes = Object.fromEntries(
      Object.entries(input).filter(
        ([key, value]) => value !== undefined && value !== current[key as keyof ProfilePatch],
      ),
    ) as ProfilePatch;
    const changedFields = Object.keys(changes);
    if (changedFields.length === 0) return before;
    const user = (await this.store.users.updateProfile(userId, changes))!;
    // Không ghi giá trị thông tin cá nhân vào audit log, chỉ ghi tên trường đã đổi; tên hiển thị thì ghi cũ/mới như trước.
    await this.store.audit.record({
      action: 'auth.profile_updated',
      actorUserId: userId,
      ...meta,
      meta: {
        changedFields,
        ...(changes.displayName === undefined
          ? {}
          : { oldDisplayName: before.displayName, newDisplayName: changes.displayName }),
      },
    });
    // Module khác chỉ cần tên hiển thị; thông tin cá nhân không lên event bus.
    if (changes.displayName !== undefined) {
      const payload: AccessUserProfileUpdatedV1 = { userId, displayName: changes.displayName };
      await this.store.outbox.add({ type: 'access.user.profile_updated', userId, payload });
    }
    return user;
  }

  @Transactional('access')
  private async applyPasswordChange(
    userId: string,
    passwordHash: string,
    currentSid: string,
    meta: RequestMeta,
  ): Promise<string[]> {
    await this.store.users.updatePasswordHash(userId, passwordHash);
    const revokedSids = await this.store.sessions.deleteByUser(userId, currentSid);
    await this.store.audit.record({
      action: 'auth.password_changed',
      actorUserId: userId,
      ...meta,
      meta: { sid: currentSid, revokedSessions: revokedSids.length },
    });
    return revokedSids;
  }

  @Transactional('access')
  private async applySessionRevoke(userId: string, sessionId: string, meta: RequestMeta): Promise<boolean> {
    const isDeleted = await this.store.sessions.deleteOwned(sessionId, userId);
    if (isDeleted) {
      await this.store.audit.record({ action: 'auth.session_revoked', actorUserId: userId, ...meta, meta: { sid: sessionId } });
    }
    return isDeleted;
  }

  @Transactional('access')
  private async applyLogoutAll(userId: string, meta: RequestMeta): Promise<string[]> {
    const revokedSids = await this.store.sessions.deleteByUser(userId);
    await this.store.audit.record({
      action: 'auth.logout_all',
      actorUserId: userId,
      ...meta,
      meta: { revokedSessions: revokedSids.length },
    });
    return revokedSids;
  }

  private async loadUser(userId: string): Promise<UserRecord> {
    const user = await this.store.users.findById(userId);
    if (!user) throw new AccessError('not_found', USER_NOT_FOUND_MESSAGE);
    return user;
  }

  private async blockSessions(sids: string[]): Promise<void> {
    await Promise.all(sids.map((sid) => this.blocklist.block(sid, ACCESS_TOKEN_TTL_SECONDS)));
  }
}
