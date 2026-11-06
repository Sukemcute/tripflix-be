export const REGISTRATION_PASSWORD_MIN = 12;
export const REGISTRATION_CODE_TTL_MS = 10 * 60 * 1000;
export const REGISTRATION_CODE_PATTERN = /^[0-9]{8}$/;
export const INVALID_REGISTRATION_CODE = 'Mã xác thực không đúng hoặc đã hết hạn. Hãy kiểm tra lại hoặc yêu cầu mã mới.';

const COMMON_PASSWORD = /^(?:password|matkhau|mat-khau|tripflix|qwerty|admin|letmein|iloveyou|welcome)[\d!@#$%^&*._-]*$/i;
const REPEATED_PATTERN = /^(.{1,4})\1+$/u;

export function isCommonRegistrationPassword(password: string): boolean {
  const candidate = password.trim();
  return COMMON_PASSWORD.test(candidate) || REPEATED_PATTERN.test(candidate) ||
    /^(?:0123456789|1234567890|9876543210)[0-9]*$/.test(candidate);
}
