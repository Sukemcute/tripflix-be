import type { ContentPostBookingClickedV1, ContentPostViewedV1 } from '@tripflix/contracts';

/**
 * Tín hiệu Hot không có sẵn trong bảng của content (TF111): lượt xem đủ và lượt bấm đặt, lấy từ stream:app-events.
 * Thích, bình luận, lưu đã có bảng riêng kèm created_at nên job tính điểm đọc thẳng các bảng đó.
 */
export const TREND_SIGNAL_KINDS = ['view', 'booking_click'] as const;
export type TrendSignalKind = (typeof TREND_SIGNAL_KINDS)[number];

/** Sau 30 ngày, với chu kỳ bán rã 48 giờ, một tín hiệu chỉ còn 0,5^15 trọng số: coi như 0, nên xoá. */
export const TREND_SIGNAL_RETENTION_DAYS = 30;

export interface TrendSignal {
  postId: string;
  kind: TrendSignalKind;
  /** `u:<userId>` hoặc `a:<anonId>`. Mỗi người chỉ tính một lần cho mỗi loại trên mỗi bài (docs/10, chống đẩy ảo). */
  actorKey: string;
  /** Khách chưa đăng nhập: job tính điểm nhân 0,5. */
  isGuest: boolean;
  occurredAt: string;
}

interface Actor {
  viewerId: string | null;
  anonId: string | null;
}

/** Ưu tiên tài khoản: người đã đăng nhập mà app vẫn gửi anonId thì vẫn tính là người dùng. */
export function actorKeyOf({ viewerId, anonId }: Actor): { actorKey: string; isGuest: boolean } | null {
  if (viewerId) return { actorKey: `u:${viewerId}`, isGuest: false };
  if (anonId) return { actorKey: `a:${anonId}`, isGuest: true };
  return null;
}

/** Chỉ lượt xem đủ (15 giây hoặc 50% thời lượng) mới thành tín hiệu. Không biết là ai xem thì bỏ. */
export function toViewSignal(payload: ContentPostViewedV1, occurredAt: string): TrendSignal | null {
  if (!payload.isQualified) return null;
  const actor = actorKeyOf(payload);
  return actor ? { postId: payload.postId, kind: 'view', ...actor, occurredAt } : null;
}

/** Khách chỉ được tính lượt xem (docs/10), nên lượt bấm đặt của khách bị bỏ. */
export function toBookingClickSignal(
  payload: ContentPostBookingClickedV1,
  occurredAt: string,
): TrendSignal | null {
  const actor = actorKeyOf(payload);
  if (!actor || actor.isGuest) return null;
  return { postId: payload.postId, kind: 'booking_click', ...actor, occurredAt };
}
