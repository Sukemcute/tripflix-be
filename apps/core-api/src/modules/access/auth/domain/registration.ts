export const REGISTRATION_PASSWORD_MIN = 12;
export const REGISTRATION_CODE_TTL_MS = 10 * 60 * 1000;
export const REGISTRATION_CODE_PATTERN = /^[0-9]{8}$/;
/** Mỗi email xin mã cách nhau ít nhất 60 giây, như nhau dù email đã có tài khoản hay chưa. */
export const REGISTRATION_CODE_COOLDOWN_SECONDS = 60;
export const REGISTRATION_CODE_COOLDOWN_MESSAGE = 'Bạn vừa yêu cầu mã, vui lòng đợi rồi gửi lại.';
/**
 * Phiên bản Điều khoản sử dụng người dùng đồng ý khi đăng ký (trang /dieu-khoan-su-dung của web). Đổi nội dung
 * điều khoản thì tăng phiên bản này; users.terms_version cho biết mỗi người đã đồng ý bản nào.
 */
export const TERMS_VERSION = '2026-11-09';
export const TERMS_REQUIRED_MESSAGE = 'Bạn cần đồng ý Điều khoản sử dụng và Chính sách bảo mật để đăng ký';
export const INVALID_REGISTRATION_CODE = 'Mã xác thực không đúng hoặc đã hết hạn. Hãy kiểm tra lại hoặc yêu cầu mã mới.';

const COMMON_PASSWORD = /^(?:password|matkhau|mat-khau|tripflix|qwerty|admin|letmein|iloveyou|welcome)[\d!@#$%^&*._-]*$/i;
const REPEATED_PATTERN = /^(.{1,4})\1+$/u;

export function isCommonRegistrationPassword(password: string): boolean {
  const candidate = password.trim();
  return COMMON_PASSWORD.test(candidate) || REPEATED_PATTERN.test(candidate) ||
    /^(?:0123456789|1234567890|9876543210)[0-9]*$/.test(candidate);
}
