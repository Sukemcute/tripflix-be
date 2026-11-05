import { z } from 'zod';

/** Ba vai trò cố định của hệ thống (docs/architecture/10 §3.10). */
export const ROLES = ['member', 'moderator', 'superadmin'] as const;
export const roleSchema = z.enum(ROLES);
export type Role = z.infer<typeof roleSchema>;

/**
 * Phong bì chung của mọi sự kiện đi qua Redis Streams.
 * `type` dạng <nguồn>.<đối tượng>.<việc>, ví dụ commerce.order.paid.
 * Đổi payload theo kiểu phá vỡ thì tăng `version`, không sửa bản cũ.
 */
export const eventEnvelopeSchema = z.object({
  eventId: z.uuid(),
  type: z.string().regex(/^[a-z]+(\.[a-z_]+)+$/),
  version: z.number().int().positive(),
  occurredAt: z.iso.datetime(),
  producer: z.string().min(1),
  traceId: z.string().optional(),
  userId: z.uuid().nullable().optional(),
  payload: z.record(z.string(), z.unknown()),
});

export type EventEnvelope<P extends Record<string, unknown> = Record<string, unknown>> = Omit<
  z.infer<typeof eventEnvelopeSchema>,
  'payload'
> & { payload: P };

/** Payload của access.user.registered v1: có người dùng mới đăng ký. Không chứa email (dữ liệu cá nhân). */
export const AccessUserRegisteredV1Schema = z.object({
  userId: z.uuid(),
  displayName: z.string().min(1),
});
export type AccessUserRegisteredV1 = z.infer<typeof AccessUserRegisteredV1Schema>;

/** access.user.role_changed v1: superadmin cấp hoặc thu hồi quyền nhân viên. Mọi phiên của người đó đã bị thu hồi. */
export const AccessUserRoleChangedV1Schema = z.object({
  userId: z.uuid(),
  oldRole: roleSchema,
  newRole: roleSchema,
  changedBy: z.uuid(),
});
export type AccessUserRoleChangedV1 = z.infer<typeof AccessUserRoleChangedV1Schema>;

/** access.user.locked v1: tài khoản bị khoá, mọi phiên đã bị thu hồi. */
export const AccessUserLockedV1Schema = z.object({ userId: z.uuid(), lockedBy: z.uuid() });
export type AccessUserLockedV1 = z.infer<typeof AccessUserLockedV1Schema>;

/** access.user.unlocked v1: tài khoản được mở khoá, người dùng đăng nhập lại được. */
export const AccessUserUnlockedV1Schema = z.object({ userId: z.uuid(), unlockedBy: z.uuid() });
export type AccessUserUnlockedV1 = z.infer<typeof AccessUserUnlockedV1Schema>;

/** access.user.profile_updated v1: người dùng đổi tên hiển thị. Module nào lưu tên từ access.user.registered thì cập nhật theo. */
export const AccessUserProfileUpdatedV1Schema = z.object({ userId: z.uuid(), displayName: z.string().min(1) });
export type AccessUserProfileUpdatedV1 = z.infer<typeof AccessUserProfileUpdatedV1Schema>;

/**
 * Payload của access.password_reset_requested v1: notification-service gửi email đặt lại mật khẩu.
 * Có email vì bên gửi cần người nhận (docs/10 §3.5); resetUrl đã gồm token dùng một lần, sống 30 phút.
 */
export const AccessPasswordResetRequestedV1Schema = z.object({
  userId: z.uuid(),
  email: z.email(),
  displayName: z.string().min(1),
  resetUrl: z.url(),
  expiresAt: z.iso.datetime(),
});
export type AccessPasswordResetRequestedV1 = z.infer<typeof AccessPasswordResetRequestedV1Schema>;

/**
 * access.user.guest_merged v1: khách vãng lai (X-Anon-Id do app tự sinh) vừa đăng ký hoặc đăng nhập.
 * discovery, feed gộp gu đã ghi theo anonId vào userId. Phát đúng một lần mỗi lần đăng ký, đăng nhập có header.
 */
export const AccessUserGuestMergedV1Schema = z.object({ anonId: z.uuid(), userId: z.uuid() });
export type AccessUserGuestMergedV1 = z.infer<typeof AccessUserGuestMergedV1Schema>;

/** Các schema được xuất ra contracts/events/*.schema.json cho repo khác dùng. */
export const exportedSchemas: Record<string, z.ZodType> = {
  'event-envelope.v1': eventEnvelopeSchema,
  'role.v1': roleSchema,
  'access.user.registered.v1': AccessUserRegisteredV1Schema,
  'access.user.role_changed.v1': AccessUserRoleChangedV1Schema,
  'access.user.locked.v1': AccessUserLockedV1Schema,
  'access.user.unlocked.v1': AccessUserUnlockedV1Schema,
  'access.user.profile_updated.v1': AccessUserProfileUpdatedV1Schema,
  'access.password_reset_requested.v1': AccessPasswordResetRequestedV1Schema,
  'access.user.guest_merged.v1': AccessUserGuestMergedV1Schema,
};
