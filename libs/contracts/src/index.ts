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
 * commerce.order.paid v1: đơn đã thanh toán, chỗ đã bán. Mang thông tin liên hệ khách nhập khi đặt để notification gửi
 * email xác nhận; contactEmail có thể null (form không bắt buộc), khi đó notification tra email tài khoản theo userId.
 * Ba trường liên hệ thêm sau (TF37) nên optional: sự kiện cũ trong stream không có.
 */
export const CommerceOrderPaidV1Schema = z.object({
  orderId: z.uuid(),
  userId: z.uuid(),
  total: z.number().int().positive(),
  sourcePostId: z.string().nullable(),
  items: z.array(
    z.object({
      productType: z.enum(['room', 'flight']),
      productId: z.string().min(1),
      date: z.string(),
      nights: z.number().int().positive(),
      qty: z.number().int().positive(),
    }),
  ),
  confirmationCode: z.string().nullable().optional(),
  contactName: z.string().nullable().optional(),
  contactEmail: z.string().nullable().optional(),
});
export type CommerceOrderPaidV1 = z.infer<typeof CommerceOrderPaidV1Schema>;

/** content.media.transcode_requested v1: file gốc đã ghép xong, video-worker chuyển mã và ghi vào videos/{assetId}/r{revision}/. */
export const ContentMediaTranscodeRequestedV1Schema = z.object({
  assetId: z.uuid(),
  sourceKey: z.string().min(1),
  revision: z.number().int().positive(),
});
export type ContentMediaTranscodeRequestedV1 = z.infer<typeof ContentMediaTranscodeRequestedV1Schema>;

export const MEDIA_QUALITY_LEVELS = [360, 540, 720] as const;
export const mediaQualityLevelSchema = z.literal(MEDIA_QUALITY_LEVELS);
export type MediaQualityLevel = z.infer<typeof mediaQualityLevelSchema>;

export const MEDIA_ASPECTS = ['9:16', '16:9', '1:1'] as const;
export const mediaAspectSchema = z.enum(MEDIA_ASPECTS);
export type MediaAspect = z.infer<typeof mediaAspectSchema>;

/** media.rendition.completed v1: video-worker xong một mức chất lượng. Có thể gửi lại, bên nhận loại trùng theo (assetId, level). */
export const MediaRenditionCompletedV1Schema = z.object({
  assetId: z.uuid(),
  level: mediaQualityLevelSchema,
  hlsPrefix: z.string().min(1),
  durationSec: z.number().int().positive(),
  aspect: mediaAspectSchema,
});
export type MediaRenditionCompletedV1 = z.infer<typeof MediaRenditionCompletedV1Schema>;

/** media.transcode.failed v1: một mức chất lượng lỗi quá số lần thử. Mức 360 lỗi thì video không phát được. */
export const MediaTranscodeFailedV1Schema = z.object({
  assetId: z.uuid(),
  level: mediaQualityLevelSchema,
  reason: z.string().min(1),
  attempts: z.number().int().positive(),
});
export type MediaTranscodeFailedV1 = z.infer<typeof MediaTranscodeFailedV1Schema>;

/** content.comment.created v1: có bình luận mới dưới bài viết (hỗ trợ thông báo và AI worker tổng hợp). */
export const ContentCommentCreatedV1Schema = z.object({
  commentId: z.uuid(),
  postId: z.uuid(),
  postAuthorId: z.uuid(),
  authorId: z.uuid(),
  parentCommentId: z.uuid().nullable(),
  body: z.string().min(1).max(10_000),
  createdAt: z.iso.datetime(),
});
export type ContentCommentCreatedV1 = z.infer<typeof ContentCommentCreatedV1Schema>;

/** content.comment.updated v1: bình luận được chỉnh sửa nội dung. */
export const ContentCommentUpdatedV1Schema = z.object({
  commentId: z.uuid(),
  postId: z.uuid(),
  authorId: z.uuid(),
  parentCommentId: z.uuid().nullable(),
  body: z.string().min(1).max(10_000),
  updatedAt: z.iso.datetime(),
});
export type ContentCommentUpdatedV1 = z.infer<typeof ContentCommentUpdatedV1Schema>;

/** content.comment.deleted v1: bình luận bị xoá (bởi tác giả hoặc superadmin). */
export const ContentCommentDeletedV1Schema = z.object({
  commentId: z.uuid(),
  postId: z.uuid(),
  authorId: z.uuid(),
  parentCommentId: z.uuid().nullable(),
  deletedBy: z.uuid(),
  isSuperAdmin: z.boolean(),
  deletedAt: z.iso.datetime(),
});
export type ContentCommentDeletedV1 = z.infer<typeof ContentCommentDeletedV1Schema>;

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

/** content.media.ready v1: video đã có mức 360p, phát được. Phát một lần cho mỗi video. */
export const ContentMediaReadyV1Schema = z.object({
  assetId: z.uuid(),
  ownerId: z.uuid(),
  durationSec: z.number().int().positive(),
});
export type ContentMediaReadyV1 = z.infer<typeof ContentMediaReadyV1Schema>;

/** content.media.failed v1: không tạo được mức 360p, video không phát được. */
export const ContentMediaFailedV1Schema = z.object({
  assetId: z.uuid(),
  ownerId: z.uuid(),
  reason: z.string().min(1),
});
export type ContentMediaFailedV1 = z.infer<typeof ContentMediaFailedV1Schema>;

/** Các schema được xuất ra contracts/events/*.schema.json cho repo khác dùng. */
export const exportedSchemas: Record<string, z.ZodType> = {
  'event-envelope.v1': eventEnvelopeSchema,
  'role.v1': roleSchema,
  'access.user.registered.v1': AccessUserRegisteredV1Schema,
  'access.user.role_changed.v1': AccessUserRoleChangedV1Schema,
  'access.user.locked.v1': AccessUserLockedV1Schema,
  'access.user.unlocked.v1': AccessUserUnlockedV1Schema,
  'access.user.profile_updated.v1': AccessUserProfileUpdatedV1Schema,
  'commerce.order.paid.v1': CommerceOrderPaidV1Schema,
  'content.media.transcode_requested.v1': ContentMediaTranscodeRequestedV1Schema,
  'content.media.ready.v1': ContentMediaReadyV1Schema,
  'content.media.failed.v1': ContentMediaFailedV1Schema,
  'media.rendition.completed.v1': MediaRenditionCompletedV1Schema,
  'media.transcode.failed.v1': MediaTranscodeFailedV1Schema,
  'content.comment.created.v1': ContentCommentCreatedV1Schema,
  'content.comment.updated.v1': ContentCommentUpdatedV1Schema,
  'content.comment.deleted.v1': ContentCommentDeletedV1Schema,
  'access.password_reset_requested.v1': AccessPasswordResetRequestedV1Schema,
  'access.user.guest_merged.v1': AccessUserGuestMergedV1Schema,
};
