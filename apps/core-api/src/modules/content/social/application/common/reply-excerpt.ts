export const REPLY_EXCERPT_MAX_LENGTH = 120;

export interface ReplyTargetExcerptFields {
  postId: string;
  body: string;
  status?: string | null;
  creatorReview?: string | null;
  platformHeld?: boolean | null;
  deletedAt?: Date | null;
}

/**
 * Kiểm tra bình luận được trả lời còn công khai với người xem hay không (không lộ nội dung bị xoá/ẩn/giữ).
 */
export function isPublicReplyTarget(
  target: ReplyTargetExcerptFields | undefined | null,
  postId: string,
): target is ReplyTargetExcerptFields {
  if (!target || target.postId !== postId || target.deletedAt) return false;
  if (target.status !== 'visible') return false;
  if ((target.creatorReview ?? 'approved') !== 'approved') return false;
  if (target.platformHeld) return false;
  return true;
}

/**
 * Cắt đoạn trích tối đa 120 ký tự Unicode (theo code point, không cắt đôi surrogate pair / emoji).
 */
export function formatReplyExcerpt(
  body: string,
  maxCodePoints = REPLY_EXCERPT_MAX_LENGTH,
): string {
  const normalized = body.replace(/\s+/g, ' ').trim();
  const codePoints = Array.from(normalized);
  if (codePoints.length <= maxCodePoints) return normalized;
  return `${codePoints.slice(0, maxCodePoints - 1).join('').trimEnd()}…`;
}
