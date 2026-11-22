/** Link xác thực email sống 24 giờ, dùng một lần (TF05D). */
export const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

/** Gửi lại link xác thực trong 1 giờ: theo tài khoản và theo IP. */
export const RESEND_WINDOW_SECONDS = 60 * 60;
export const RESEND_MAX_PER_USER = 3;
export const RESEND_MAX_PER_IP = 20;

/** Đăng ký bằng mật khẩu trong 1 giờ theo IP (mặc định; đổi bằng AUTH_REGISTER_MAX_PER_IP_HOUR). */
export const REGISTER_WINDOW_SECONDS = 60 * 60;
export const DEFAULT_REGISTER_MAX_PER_IP = 5;

export const INVALID_VERIFY_TOKEN_MESSAGE = 'Liên kết xác thực email không hợp lệ hoặc đã hết hạn';
export const TOO_MANY_RESENDS_MESSAGE =
  'Bạn đã yêu cầu gửi lại email xác thực quá nhiều lần, vui lòng thử lại sau';
export const TOO_MANY_SIGNUPS_MESSAGE = 'Bạn đã tạo quá nhiều tài khoản, vui lòng thử lại sau';
export const VERIFICATION_SENT_MESSAGE = 'Đã gửi email xác thực, vui lòng kiểm tra hộp thư';

/** Link trong email: trang xác thực của web kèm ?token=... (giữ nguyên query sẵn có của trang). */
export function buildVerifyUrl(pageUrl: string, token: string): string {
  const url = new URL(pageUrl);
  url.searchParams.set('token', token);
  return url.toString();
}
