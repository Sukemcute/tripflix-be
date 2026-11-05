export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

/** Mọi lỗi đăng nhập trả cùng một thông báo, để không lộ email nào đã có tài khoản. */
export const INVALID_CREDENTIALS_MESSAGE = 'Email hoặc mật khẩu không đúng';
export const TOO_MANY_ATTEMPTS_MESSAGE = 'Bạn đã đăng nhập sai quá nhiều lần, vui lòng thử lại sau';
export const EMAIL_TAKEN_MESSAGE = 'Email này đã được dùng để đăng ký';
export const SESSION_REVOKED_MESSAGE = 'Phiên đăng nhập đã bị thu hồi, vui lòng đăng nhập lại';
export const INVALID_REFRESH_MESSAGE = 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn';
export const GOOGLE_LOGIN_FAILED_MESSAGE = 'Đăng nhập bằng Google không thành công';
export const GOOGLE_NOT_CONFIGURED_MESSAGE = 'Đăng nhập bằng Google chưa được bật';

/** Giới hạn đăng nhập sai trong 15 phút: theo email và theo IP. */
export const LOGIN_WINDOW_SECONDS = 15 * 60;
export const LOGIN_MAX_FAILS_PER_EMAIL = 5;
export const LOGIN_MAX_FAILS_PER_IP = 20;

/** Tên hiển thị cho tài khoản tạo từ Google: tên trên Google, không có thì phần trước @ của email. */
export function buildDisplayName(name: string | null, email: string): string {
  const candidate = (name ?? email.split('@')[0] ?? '').trim().slice(0, 50);
  return candidate || 'Thành viên Tripflix';
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
