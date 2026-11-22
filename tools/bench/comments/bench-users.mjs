// TF99: thông tin chung của tài khoản thử, dùng cho setup-users.mjs và các script k6.
// Mật khẩu chỉ dùng cho tài khoản thử trên DB local hoặc DB riêng để đo, không phải bí mật.
export const BENCH_USER_COUNT = 5;
export const BENCH_PASSWORD = 'tf99-bench-only-local-db';
export const BENCH_POST_ID = '0000be0c-0000-4000-8000-000000000001';

export function benchEmail(index) {
  return `bench-${index}@tripflix.local`;
}
