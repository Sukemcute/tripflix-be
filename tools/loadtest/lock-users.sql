-- Sau buổi test: khoá tài khoản load test thay vì xoá (RULES §8 cấm xoá dữ liệu trên server).
-- Tài khoản bị khoá không đăng nhập, không refresh được nữa. Lần test sau mở lại bằng status = 'active'.
UPDATE access.users SET status = 'locked', updated_at = now()
WHERE email LIKE 'loadtest%@tripflix.local' AND status = 'active';
