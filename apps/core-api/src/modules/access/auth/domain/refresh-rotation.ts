/** Access token sống 15 phút (docs/architecture/10 §3.10). */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
/** Refresh token cũ dùng lại trong khoảng này vẫn được nhận, phòng khi mạng làm mất phản hồi của lần làm mới trước. */
export const REFRESH_GRACE_MS = 10_000;
/** Refresh token sống 30 ngày, tính lại mỗi lần xoay vòng. */
export const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface RefreshState {
  refreshTokenHash: string;
  previousTokenHash: string | null;
  rotatedAt: Date | null;
  expiresAt: Date;
}

/**
 * - rotate: đúng token hiện tại, cấp cặp mới.
 * - grace: token liền trước, vừa xoay trong 10 giây, cấp cặp mới (client chưa nhận được cặp trước).
 * - reuse: token liền trước nhưng đã quá 10 giây, coi như bị đánh cắp, thu hồi cả phiên.
 * - invalid: phiên hết hạn hoặc token không khớp.
 */
export type RefreshDecision = 'rotate' | 'grace' | 'reuse' | 'invalid';

export function decideRefresh(session: RefreshState, presentedHash: string, now: Date): RefreshDecision {
  if (session.expiresAt.getTime() <= now.getTime()) return 'invalid';
  if (presentedHash === session.refreshTokenHash) return 'rotate';
  if (presentedHash === session.previousTokenHash) {
    const rotatedAt = session.rotatedAt?.getTime() ?? 0;
    return now.getTime() - rotatedAt <= REFRESH_GRACE_MS ? 'grace' : 'reuse';
  }
  return 'invalid';
}
