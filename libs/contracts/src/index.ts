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
export const AccessUserProfileUpdatedV1Schema = z.object({
  userId: z.uuid(),
  displayName: z.string().min(1),
});
export type AccessUserProfileUpdatedV1 = z.infer<typeof AccessUserProfileUpdatedV1Schema>;

/**
 * commerce.order.paid v1: đơn đã thanh toán, chỗ đã bán. Mang thông tin liên hệ khách nhập khi đặt để notification gửi
 * email xác nhận; contactEmail có thể null (form không bắt buộc), khi đó notification tra email tài khoản theo userId.
 * Các trường bổ sung mã xác nhận và liên hệ đều optional để đọc sự kiện cũ.
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
      // Thêm sau để email xác nhận hiện đủ thông tin nên optional: sự kiện cũ trong stream không có.
      productName: z.string().optional(),
      propertyName: z.string().nullable().optional(),
      ratePlanName: z.string().optional(),
      flight: z
        .object({
          fromAirport: z.string(),
          toAirport: z.string(),
          departTime: z.string().nullable(),
          arriveTime: z.string().nullable(),
        })
        .nullable()
        .optional(),
    }),
  ),
  guests: z
    .array(z.object({ fullName: z.string(), passengerType: z.enum(['adult', 'child', 'infant']).nullable() }))
    .optional(),
  confirmationCode: z.string().nullable().optional(),
  contactName: z.string().nullable().optional(),
  contactPhone: z.string().nullable().optional(),
  contactEmail: z.string().nullable().optional(),
});
export type CommerceOrderPaidV1 = z.infer<typeof CommerceOrderPaidV1Schema>;

/** commerce.order.cancelled v1: khách huỷ đơn đã thanh toán, chỗ đã trả về kho. Mang sẵn dữ liệu để notification báo huỷ. */
export const CommerceOrderCancelledV1Schema = z.object({
  orderId: z.uuid(),
  userId: z.uuid(),
  total: z.number().int().positive(),
  refundAmount: z.number().int().nonnegative(),
  feeAmount: z.number().int().nonnegative(),
  confirmationCode: z.string().nullable(),
  contactName: z.string().nullable(),
  contactEmail: z.string().nullable(),
});
export type CommerceOrderCancelledV1 = z.infer<typeof CommerceOrderCancelledV1Schema>;

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

export const ContentReactionUpdatedV1Schema = z.object({
  postId: z.uuid(),
  postAuthorId: z.uuid().optional(),
  userId: z.uuid(),
  type: z.enum(['like', 'love', 'helpful']).nullable(),
  reactionTotal: z.int().nonnegative(),
  reactionCounts: z.record(z.string(), z.int().nonnegative()),
});

export const ContentCommentReactionUpdatedV1Schema = z.object({
  commentId: z.uuid(),
  postId: z.uuid(),
  commentAuthorId: z.uuid(),
  userId: z.uuid(),
  isLiked: z.boolean(),
  likeCount: z.int().nonnegative(),
});

/** content.comment.created v1: có bình luận mới dưới bài viết (hỗ trợ thông báo và AI worker tổng hợp). */
export const ContentCommentCreatedV1Schema = z.object({
  commentId: z.uuid(),
  postId: z.uuid(),
  postAuthorId: z.uuid(),
  authorId: z.uuid(),
  parentCommentId: z.uuid().nullable(),
  parentCommentAuthorId: z.uuid().nullable().optional(),
  replyToCommentId: z.uuid().optional(),
  replyToAuthorId: z.uuid().optional(),
  authorDisplayName: z.string().min(1).optional(),
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

/**
 * access.user.welcome_email_requested v1: tài khoản vừa được tạo bằng Google lần đầu (TF05D: đăng ký bằng mật khẩu
 * dùng access.email_verification_requested reason "signup"; provider "password" giữ lại cho sự kiện cũ),
 * notification-service gửi email chào mừng. Có email vì bên gửi cần người nhận (docs/10 §3.5); chỉ
 * notification-service dùng sự kiện này, module khác nghe access.user.registered (không có email).
 */
export const AccessUserWelcomeEmailRequestedV1Schema = z.object({
  userId: z.uuid(),
  email: z.email(),
  displayName: z.string().min(1),
  provider: z.enum(['password', 'google']),
});
export type AccessUserWelcomeEmailRequestedV1 = z.infer<typeof AccessUserWelcomeEmailRequestedV1Schema>;

/**
 * access.email_verification_requested v1 (TF05D): notification-service gửi email xác nhận địa chỉ email.
 * reason "signup": vừa đăng ký bằng mật khẩu, email gộp lời chào mừng (thay access.user.welcome_email_requested);
 * "resend": người dùng bấm gửi lại. verifyUrl đã gồm token dùng một lần, sống 24 giờ. Có email vì bên gửi cần
 * người nhận (docs/10 §3.5); chỉ notification-service dùng sự kiện này.
 */
export const AccessEmailVerificationRequestedV1Schema = z.object({
  userId: z.uuid(),
  email: z.email(),
  displayName: z.string().min(1),
  verifyUrl: z.url(),
  expiresAt: z.iso.datetime(),
  reason: z.enum(['signup', 'resend']),
});
export type AccessEmailVerificationRequestedV1 = z.infer<typeof AccessEmailVerificationRequestedV1Schema>;

export const AccessRegistrationCodeRequestedV1Schema = z.object({
  email: z.email(),
  code: z.string().regex(/^[0-9]{8}$/),
  expiresAt: z.iso.datetime(),
});
export type AccessRegistrationCodeRequestedV1 = z.infer<typeof AccessRegistrationCodeRequestedV1Schema>;

/**
 * access.registration_attempted_existing v1: ai đó xin mã đăng ký bằng email đã có tài khoản đang hoạt động.
 * API vẫn trả như email mới (không lộ email nào đã đăng ký); notification-service báo cho chủ email biết họ đã có
 * tài khoản, kèm cách đăng nhập. hasPassword false: tài khoản chỉ đăng nhập bằng Google. Chỉ notification-service dùng.
 */
export const AccessRegistrationAttemptedExistingV1Schema = z.object({
  userId: z.uuid(),
  email: z.email(),
  displayName: z.string().min(1),
  hasPassword: z.boolean(),
});
export type AccessRegistrationAttemptedExistingV1 = z.infer<
  typeof AccessRegistrationAttemptedExistingV1Schema
>;

/**
 * access.session_reuse_detected v1: refresh token cũ của một phiên bị dùng lại, nghi bị đánh cắp; phiên đã bị huỷ.
 * notification-service báo chủ tài khoản để đăng nhập lại và đổi mật khẩu nếu không phải họ. Chỉ notification-service dùng.
 */
export const AccessSessionReuseDetectedV1Schema = z.object({
  userId: z.uuid(),
  email: z.email(),
  displayName: z.string().min(1),
  deviceName: z.string().nullable(),
});
export type AccessSessionReuseDetectedV1 = z.infer<typeof AccessSessionReuseDetectedV1Schema>;

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
export const ContentCommentHiddenV1Schema = z.object({
  postId: z.uuid(),
  commentId: z.uuid(),
  authorId: z.uuid(),
});
export const ContentCommentRestoredV1Schema = ContentCommentHiddenV1Schema;
export const ContentPostHiddenV1Schema = z.object({
  postId: z.uuid(),
  authorId: z.uuid(),
  previousStatus: z.string(),
  postStatus: z.string(),
  actionId: z.uuid(),
  reasonCode: z.string(),
  hiddenAt: z.iso.datetime(),
});
export const ContentPostRestoredV1Schema = ContentPostHiddenV1Schema;
export const ContentModerationDecidedV1Schema = z.object({
  caseId: z.uuid(),
  targetType: z.enum(['post', 'comment']),
  targetId: z.uuid(),
  postId: z.uuid(),
  authorId: z.uuid(),
  action: z.enum(['hide', 'restore', 'remove', 'dismiss']),
  reasonCode: z.string(),
  isAutomatic: z.boolean(),
});
export const ContentAppealDecidedV1Schema = z.object({
  appealId: z.uuid(), authorId: z.uuid(), decisionId: z.uuid(),
  outcome: z.enum(['upheld', 'overturned']),
});
export const ContentCommentModerationActionV1Schema = z.object({
  actionId: z.uuid(), postId: z.uuid(), commentId: z.uuid(), authorId: z.uuid(),
  action: z.enum(['hide', 'remove', 'restore']), reasonCode: z.string(),
});
export const ContentReportCreatedV1Schema = z.object({
  reportId: z.uuid(),
  caseId: z.uuid(),
  targetType: z.enum(['post', 'comment']),
  targetId: z.uuid(),
  postId: z.uuid(),
  reasonCode: z.string(),
});
export type ContentModerationDecidedV1 = z.infer<typeof ContentModerationDecidedV1Schema>;
export type ContentCommentHiddenV1 = z.infer<typeof ContentCommentHiddenV1Schema>;
export type ContentCommentRestoredV1 = z.infer<typeof ContentCommentRestoredV1Schema>;

/**
 * discovery.search.performed v1: người dùng đã đăng nhập tìm ở explore (POST /api/search) hoặc bài viết
 * (POST /api/search/posts). Chỉ giữ tín hiệu gu cho gợi ý: không lưu nguyên câu tìm, không lưu vị trí GPS.
 */
export const DiscoverySearchPerformedV1Schema = z.object({
  userId: z.uuid(),
  surface: z.enum(['explore', 'posts']),
  /** Nơi nhận ra từ câu tìm, có thể rỗng. */
  placeIds: z.array(z.string()).max(10),
  /** Loại ý định explore đã nhận ra, null nếu không có. */
  intent: z.string().nullable(),
  budgetMax: z.number().int().nonnegative().nullable(),
  /** Chỉ có với surface 'posts'. */
  postType: z.string().nullable(),
  resultCount: z.number().int().nonnegative(),
});
export type DiscoverySearchPerformedV1 = z.infer<typeof DiscoverySearchPerformedV1Schema>;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** discovery.stays.searched v1: người dùng đã đăng nhập tìm chỗ ở (GET /api/stays). */
export const DiscoveryStaysSearchedV1Schema = z.object({
  userId: z.uuid(),
  placeId: z.string(),
  checkIn: isoDate,
  checkOut: isoDate,
  adults: z.number().int().min(1),
  rooms: z.number().int().min(1).nullable(),
  minStars: z.number().int().min(1).max(5).nullable(),
  priceMax: z.number().int().nonnegative().nullable(),
  resultCount: z.number().int().nonnegative(),
});
export type DiscoveryStaysSearchedV1 = z.infer<typeof DiscoveryStaysSearchedV1Schema>;

export const exportedSchemas: Record<string, z.ZodType> = {
  'content.comment.hidden.v1': ContentCommentHiddenV1Schema,
  'content.comment.restored.v1': ContentCommentRestoredV1Schema,
  'content.post.hidden.v1': ContentPostHiddenV1Schema,
  'content.post.restored.v1': ContentPostRestoredV1Schema,
  'content.moderation.decided.v1': ContentModerationDecidedV1Schema,
  'content.appeal.decided.v1': ContentAppealDecidedV1Schema,
  'content.comment.moderation_action.v1': ContentCommentModerationActionV1Schema,
  'content.report.created.v1': ContentReportCreatedV1Schema,
  'event-envelope.v1': eventEnvelopeSchema,
  'role.v1': roleSchema,
  'access.user.registered.v1': AccessUserRegisteredV1Schema,
  'access.user.role_changed.v1': AccessUserRoleChangedV1Schema,
  'access.user.locked.v1': AccessUserLockedV1Schema,
  'access.user.unlocked.v1': AccessUserUnlockedV1Schema,
  'access.user.profile_updated.v1': AccessUserProfileUpdatedV1Schema,
  'commerce.order.paid.v1': CommerceOrderPaidV1Schema,
  'commerce.order.cancelled.v1': CommerceOrderCancelledV1Schema,
  'content.media.transcode_requested.v1': ContentMediaTranscodeRequestedV1Schema,
  'content.media.ready.v1': ContentMediaReadyV1Schema,
  'content.media.failed.v1': ContentMediaFailedV1Schema,
  'media.rendition.completed.v1': MediaRenditionCompletedV1Schema,
  'media.transcode.failed.v1': MediaTranscodeFailedV1Schema,
  'content.reaction.updated.v1': ContentReactionUpdatedV1Schema,
  'content.comment_reaction.updated.v1': ContentCommentReactionUpdatedV1Schema,
  'content.comment.created.v1': ContentCommentCreatedV1Schema,
  'content.comment.updated.v1': ContentCommentUpdatedV1Schema,
  'content.comment.deleted.v1': ContentCommentDeletedV1Schema,
  'access.password_reset_requested.v1': AccessPasswordResetRequestedV1Schema,
  'access.user.guest_merged.v1': AccessUserGuestMergedV1Schema,
  'access.user.welcome_email_requested.v1': AccessUserWelcomeEmailRequestedV1Schema,
  'access.email_verification_requested.v1': AccessEmailVerificationRequestedV1Schema,
  'access.registration_code_requested.v1': AccessRegistrationCodeRequestedV1Schema,
  'access.registration_attempted_existing.v1': AccessRegistrationAttemptedExistingV1Schema,
  'access.session_reuse_detected.v1': AccessSessionReuseDetectedV1Schema,
  'discovery.search.performed.v1': DiscoverySearchPerformedV1Schema,
  'discovery.stays.searched.v1': DiscoveryStaysSearchedV1Schema,
};
