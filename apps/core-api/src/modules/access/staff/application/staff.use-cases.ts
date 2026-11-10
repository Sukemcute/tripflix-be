import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { AuthUser, SidBlocklist } from '@tripflix/auth';
import type {
  AccessUserLockedV1,
  AccessUserRoleChangedV1,
  AccessUserUnlockedV1,
  Role,
} from '@tripflix/contracts';
import { Transactional } from '@tripflix/db';
import {
  ACCESS_SID_BLOCKLIST,
  ACCESS_STORE,
  type AccessStore,
  type RequestMeta,
  type UserRecord,
} from '../../auth/application/ports.js';
import { mapPublicUser, type PublicUser } from '../../auth/application/public-user.js';
import { buildDisplayName, normalizeEmail } from '../../auth/domain/credentials.js';
import { AccessError } from '../../auth/domain/errors.js';
import { ACCESS_TOKEN_TTL_SECONDS } from '../../auth/domain/refresh-rotation.js';
import { PasswordResetUseCases } from '../../account/application/password-reset.use-cases.js';
import { STAFF_DENIAL_MESSAGES, checkStaffAction, maskEmail, type StaffAction } from '../domain/staff-policy.js';

export const USER_NOT_FOUND_MESSAGE = 'Không tìm thấy người dùng';
export const ADMIN_PAGE_SIZE = 20;

/** Người dùng hiện ở trang quản trị; moderator chỉ thấy email đã che. */
export interface AdminUserView extends PublicUser {
  status: UserRecord['status'];
}

export interface AdminUserPage {
  items: AdminUserView[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Việc của trang quản trị (Back Office). Đổi quyền hoặc khoá thì xoá mọi phiên của người đó trong cùng
 * transaction, rồi chặn từng sid trong Redis để access token cũ bị từ chối ngay ở request kế tiếp.
 */
@Injectable()
export class StaffUseCases {
  constructor(
    @Inject(ACCESS_STORE) private readonly store: AccessStore,
    @Inject(ACCESS_SID_BLOCKLIST) private readonly blocklist: SidBlocklist,
    @Inject(PasswordResetUseCases) private readonly resets: PasswordResetUseCases,
  ) {}

  @Transactional('access')
  async createStaff(
    actor: AuthUser,
    input: { email: string; displayName: string; role?: 'moderator' },
    meta: RequestMeta,
  ): Promise<AdminUserView> {
    if (actor.role !== 'superadmin') {
      throw new AccessError('staff_rule', 'Chỉ superadmin mới có quyền tạo tài khoản nhân sự');
    }
    const cleanEmail = normalizeEmail(input.email);
    const existing = await this.store.users.findByEmail(cleanEmail);
    if (existing) {
      throw new BadRequestException('Email đã tồn tại trong hệ thống');
    }
    // TF056: superadmin không biết mật khẩu của nhân sự. Tài khoản chưa có mật khẩu, nhân sự nhận email để tự đặt.
    // TODO(TF056C): thư mời riêng 24 giờ; chỉ đánh dấu email đã xác thực khi nhân sự mở link.
    const user = await this.store.users.insert({
      email: cleanEmail,
      displayName: buildDisplayName(input.displayName, cleanEmail),
      passwordHash: null,
      role: 'moderator',
      emailVerifiedAt: new Date(),
    });
    if (!user) throw new BadRequestException('Không thể tạo tài khoản');
    await this.store.audit.record({
      action: 'staff.role_granted',
      actorUserId: actor.userId,
      ...meta,
      meta: { createdUserId: user.id, email: user.email, role: user.role, passwordSetBy: 'email' },
    });
    await this.resets.sendPasswordSetupLink(user, meta);
    return { ...mapPublicUser(user), status: user.status };
  }

  async listStaff(): Promise<PublicUser[]> {
    return (await this.store.users.listStaff()).map(mapPublicUser);
  }

  async searchUsers(actor: AuthUser, options: { query?: string | undefined; page: number }): Promise<AdminUserPage> {
    const { items, total } = await this.store.users.search({
      query: options.query?.trim() || undefined,
      limit: ADMIN_PAGE_SIZE,
      offset: (options.page - 1) * ADMIN_PAGE_SIZE,
    });
    const isSuperadmin = actor.role === 'superadmin';
    return {
      items: items.map((u) => {
        const view = { ...mapPublicUser(u), status: u.status };
        return isSuperadmin ? view : { ...view, email: maskEmail(u.email) };
      }),
      total,
      page: options.page,
      pageSize: ADMIN_PAGE_SIZE,
    };
  }

  grantModerator(actor: AuthUser, userId: string, meta: RequestMeta): Promise<AdminUserView> {
    return this.changeRole(actor, userId, 'grant_moderator', 'moderator', meta);
  }

  revokeModerator(actor: AuthUser, userId: string, meta: RequestMeta): Promise<AdminUserView> {
    return this.changeRole(actor, userId, 'revoke_moderator', 'member', meta);
  }

  async lock(actor: AuthUser, userId: string, meta: RequestMeta): Promise<AdminUserView> {
    const { user, revokedSids } = await this.applyLock(actor, userId, meta);
    await this.blockSessions(revokedSids);
    return { ...mapPublicUser(user), status: user.status };
  }

  async unlock(actor: AuthUser, userId: string, meta: RequestMeta): Promise<AdminUserView> {
    const user = await this.applyUnlock(actor, userId, meta);
    return { ...mapPublicUser(user), status: user.status };
  }

  private async changeRole(
    actor: AuthUser,
    userId: string,
    action: Extract<StaffAction, 'grant_moderator' | 'revoke_moderator'>,
    newRole: Role,
    meta: RequestMeta,
  ): Promise<AdminUserView> {
    const { user, revokedSids } = await this.applyRoleChange(actor, userId, action, newRole, meta);
    // Token cũ mang role cũ: chặn ngay, người dùng đăng nhập lại sẽ nhận role mới.
    await this.blockSessions(revokedSids);
    return { ...mapPublicUser(user), status: user.status };
  }

  @Transactional('access')
  private async applyRoleChange(
    actor: AuthUser,
    userId: string,
    action: StaffAction,
    newRole: Role,
    meta: RequestMeta,
  ): Promise<{ user: UserRecord; revokedSids: string[] }> {
    const target = await this.loadAllowedTarget(actor, userId, action);
    const user = (await this.store.users.updateRole(target.id, newRole))!;
    const revokedSids = await this.store.sessions.deleteByUser(target.id);
    await this.store.audit.record({
      action: action === 'grant_moderator' ? 'staff.role_granted' : 'staff.role_revoked',
      actorUserId: actor.userId,
      ...meta,
      meta: { targetUserId: target.id, oldRole: target.role, newRole, revokedSessions: revokedSids.length },
    });
    const payload: AccessUserRoleChangedV1 = { userId: target.id, oldRole: target.role, newRole, changedBy: actor.userId };
    await this.store.outbox.add({ type: 'access.user.role_changed', userId: target.id, payload });
    return { user, revokedSids };
  }

  @Transactional('access')
  private async applyLock(
    actor: AuthUser,
    userId: string,
    meta: RequestMeta,
  ): Promise<{ user: UserRecord; revokedSids: string[] }> {
    const target = await this.loadAllowedTarget(actor, userId, 'lock');
    const user = (await this.store.users.updateStatus(target.id, 'locked'))!;
    const revokedSids = await this.store.sessions.deleteByUser(target.id);
    await this.store.audit.record({
      action: 'user.locked',
      actorUserId: actor.userId,
      ...meta,
      meta: { targetUserId: target.id, revokedSessions: revokedSids.length },
    });
    const payload: AccessUserLockedV1 = { userId: target.id, lockedBy: actor.userId };
    await this.store.outbox.add({ type: 'access.user.locked', userId: target.id, payload });
    return { user, revokedSids };
  }

  @Transactional('access')
  private async applyUnlock(actor: AuthUser, userId: string, meta: RequestMeta): Promise<UserRecord> {
    const target = await this.loadAllowedTarget(actor, userId, 'unlock');
    const user = (await this.store.users.updateStatus(target.id, 'active'))!;
    await this.store.audit.record({ action: 'user.unlocked', actorUserId: actor.userId, ...meta, meta: { targetUserId: target.id } });
    const payload: AccessUserUnlockedV1 = { userId: target.id, unlockedBy: actor.userId };
    await this.store.outbox.add({ type: 'access.user.unlocked', userId: target.id, payload });
    return user;
  }

  private async loadAllowedTarget(actor: AuthUser, userId: string, action: StaffAction): Promise<UserRecord> {
    const target = await this.store.users.findById(userId);
    if (!target) throw new AccessError('not_found', USER_NOT_FOUND_MESSAGE);
    const denial = checkStaffAction(action, { userId: actor.userId, role: actor.role }, target);
    if (denial) throw new AccessError('staff_rule', STAFF_DENIAL_MESSAGES[denial]);
    return target;
  }

  private async blockSessions(sids: string[]): Promise<void> {
    await Promise.all(sids.map((sid) => this.blocklist.block(sid, ACCESS_TOKEN_TTL_SECONDS)));
  }
}
