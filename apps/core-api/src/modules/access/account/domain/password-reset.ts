/** Link đặt lại mật khẩu sống 30 phút, dùng một lần. */
export const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;

/** Giới hạn yêu cầu quên mật khẩu trong 1 giờ, tính cả lần thành công: theo email và theo IP. */
export const FORGOT_WINDOW_SECONDS = 60 * 60;
export const FORGOT_MAX_PER_EMAIL = 3;
export const FORGOT_MAX_PER_IP = 20;

/** Luôn trả câu này, kể cả email không có tài khoản, để không lộ email nào đã đăng ký. */
export const FORGOT_ACCEPTED_MESSAGE = 'Nếu email này có tài khoản, chúng tôi đã gửi hướng dẫn đặt lại mật khẩu';
export const INVALID_RESET_TOKEN_MESSAGE = 'Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn';
export const TOO_MANY_RESET_REQUESTS_MESSAGE = 'Bạn đã yêu cầu đặt lại mật khẩu quá nhiều lần, vui lòng thử lại sau';

/** Link trong email: trang đặt lại mật khẩu của web kèm ?token=... (giữ nguyên query sẵn có của trang). */
export function buildResetUrl(pageUrl: string, token: string): string {
  const url = new URL(pageUrl);
  url.searchParams.set('token', token);
  return url.toString();
}
