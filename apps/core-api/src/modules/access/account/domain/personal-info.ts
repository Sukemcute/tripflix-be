/**
 * Thông tin cá nhân trong hồ sơ (TF06M). Chỉ chủ tài khoản xem và sửa; không gửi sang module khác.
 * Quy tắc ở đây dùng chung cho kiểm tra đầu vào (dto.ts) và test; DB có check tương ứng (db/schema).
 */
export const GENDERS = ['male', 'female', 'other'] as const;
export type Gender = (typeof GENDERS)[number];

/** 8–15 chữ số, cho phép "+" ở đầu (ví dụ 0912345678, +84912345678). Dấu cách, chấm, gạch được bỏ trước khi kiểm. */
export const PHONE_PATTERN = /^\+?[0-9]{8,15}$/;
/** Mã quốc gia ISO 3166-1 alpha-2, chữ hoa (VN, US…). */
export const NATIONALITY_PATTERN = /^[A-Z]{2}$/;
export const MIN_AGE = 13;
export const MAX_AGE = 120;

export interface PersonalInfo {
  phone: string | null;
  /** YYYY-MM-DD */
  dateOfBirth: string | null;
  gender: Gender | null;
  nationality: string | null;
}

export function normalizePhone(value: string): string {
  return value.replace(/[\s.\-()]/g, '');
}

/** Tuổi tròn năm tại ngày `today` (UTC) của ngày sinh YYYY-MM-DD. */
export function ageOn(dateOfBirth: string, today: Date): number {
  const [y, m, d] = dateOfBirth.split('-').map(Number) as [number, number, number];
  let age = today.getUTCFullYear() - y;
  const beforeBirthday = today.getUTCMonth() + 1 < m || (today.getUTCMonth() + 1 === m && today.getUTCDate() < d);
  if (beforeBirthday) age -= 1;
  return age;
}

export function isAllowedAge(dateOfBirth: string, today: Date): boolean {
  const age = ageOn(dateOfBirth, today);
  return age >= MIN_AGE && age <= MAX_AGE;
}
