// TF99: thông tin chung của tài khoản thử, dùng cho setup-users.mjs và các script k6.
// Mặc định là tài khoản trên DB local (mật khẩu này không phải bí mật). Đo trên server thì đặt biến môi trường
// (k6 nhận qua -e, Node qua env), không ghi mật khẩu thật vào repo:
//   BENCH_PASSWORD        mật khẩu chung của 5 tài khoản
//   BENCH_EMAIL_TEMPLATE  mẫu email, {i} thay bằng 1..5 (vd "ai+bench{i}@example.com")
//   BENCH_POST_ID         id bài thử (trên server bài tạo qua API nên id ngẫu nhiên)
const ENV = typeof __ENV !== 'undefined' ? __ENV : typeof process !== 'undefined' ? process.env : {};

export const BENCH_USER_COUNT = 5;
export const BENCH_PASSWORD = ENV.BENCH_PASSWORD || 'tf99-bench-only-local-db';
export const BENCH_POST_ID = ENV.BENCH_POST_ID || '0000be0c-0000-4000-8000-000000000001';
const EMAIL_TEMPLATE = ENV.BENCH_EMAIL_TEMPLATE || 'bench-{i}@tripflix.local';

export function benchEmail(index) {
  return EMAIL_TEMPLATE.replace('{i}', String(index));
}
