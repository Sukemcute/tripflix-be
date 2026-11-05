import type { Role } from '@tripflix/contracts';

export interface StaffActor {
  userId: string;
  role: Role;
}

export interface StaffTarget {
  id: string;
  role: Role;
  status: 'active' | 'locked';
}

export type StaffAction = 'grant_moderator' | 'revoke_moderator' | 'lock' | 'unlock';

/** Lý do không được làm; null là được phép. */
export type StaffDenial =
  | 'self_action'
  | 'target_is_superadmin'
  | 'target_locked'
  | 'already_moderator'
  | 'not_moderator'
  | 'already_locked'
  | 'not_locked';

export const STAFF_DENIAL_MESSAGES: Record<StaffDenial, string> = {
  self_action: 'Không thể tự đổi quyền hoặc khoá tài khoản của chính mình',
  target_is_superadmin: 'Không thể đổi quyền hoặc khoá tài khoản quản trị viên',
  target_locked: 'Tài khoản đang bị khoá, mở khoá trước khi cấp quyền',
  already_moderator: 'Tài khoản đã là kiểm duyệt viên',
  not_moderator: 'Tài khoản không phải kiểm duyệt viên',
  already_locked: 'Tài khoản đã bị khoá',
  not_locked: 'Tài khoản không bị khoá',
};

/**
 * Quy tắc quản lý nhân viên (superadmin gọi). Superadmin đầu tiên tạo bằng seed; không ai đổi quyền hay khoá
 * được superadmin, nên luôn còn ít nhất một superadmin.
 */
export function checkStaffAction(action: StaffAction, actor: StaffActor, target: StaffTarget): StaffDenial | null {
  if (actor.userId === target.id) return 'self_action';
  if (target.role === 'superadmin') return 'target_is_superadmin';
  switch (action) {
    case 'grant_moderator':
      if (target.status !== 'active') return 'target_locked';
      return target.role === 'moderator' ? 'already_moderator' : null;
    case 'revoke_moderator':
      return target.role === 'moderator' ? null : 'not_moderator';
    case 'lock':
      return target.status === 'locked' ? 'already_locked' : null;
    case 'unlock':
      return target.status === 'locked' ? null : 'not_locked';
  }
}

/** Che email cho moderator: kiểm duyệt viên không cần biết email đầy đủ (docs/10 §3.10, dữ liệu đã che từ API). */
export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return '***';
  const local = email.slice(0, at);
  return `${local.slice(0, Math.min(2, local.length - 1) || 1)}***${email.slice(at)}`;
}
