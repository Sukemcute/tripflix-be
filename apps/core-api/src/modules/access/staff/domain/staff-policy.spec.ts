import { checkStaffAction, maskEmail, type StaffActor, type StaffTarget } from './staff-policy.js';

const admin: StaffActor = { userId: 'admin', role: 'superadmin' };
const member = (over: Partial<StaffTarget> = {}): StaffTarget => ({ id: 'u1', role: 'member', status: 'active', ...over });

describe('checkStaffAction', () => {
  it('superadmin cấp quyền moderator cho member đang hoạt động', () => {
    expect(checkStaffAction('grant_moderator', admin, member())).toBeNull();
  });

  it('không tự đổi quyền hay khoá chính mình', () => {
    for (const action of ['grant_moderator', 'revoke_moderator', 'lock', 'unlock'] as const) {
      expect(checkStaffAction(action, admin, member({ id: 'admin', role: 'superadmin' }))).toBe('self_action');
    }
  });

  it('không đổi quyền hay khoá superadmin khác', () => {
    expect(checkStaffAction('revoke_moderator', admin, member({ role: 'superadmin' }))).toBe('target_is_superadmin');
    expect(checkStaffAction('lock', admin, member({ role: 'superadmin' }))).toBe('target_is_superadmin');
  });

  it('kiểm trạng thái hiện tại', () => {
    expect(checkStaffAction('grant_moderator', admin, member({ status: 'locked' }))).toBe('target_locked');
    expect(checkStaffAction('grant_moderator', admin, member({ role: 'moderator' }))).toBe('already_moderator');
    expect(checkStaffAction('revoke_moderator', admin, member())).toBe('not_moderator');
    expect(checkStaffAction('lock', admin, member({ status: 'locked' }))).toBe('already_locked');
    expect(checkStaffAction('unlock', admin, member())).toBe('not_locked');
    expect(checkStaffAction('lock', admin, member({ role: 'moderator' }))).toBeNull();
  });
});

describe('maskEmail', () => {
  it('giữ 2 ký tự đầu và tên miền', () => {
    expect(maskEmail('khang@example.com')).toBe('kh***@example.com');
    expect(maskEmail('ab@x.vn')).toBe('a***@x.vn');
    expect(maskEmail('a@x.vn')).toBe('a***@x.vn');
    expect(maskEmail('khong-hop-le')).toBe('***');
  });
});
