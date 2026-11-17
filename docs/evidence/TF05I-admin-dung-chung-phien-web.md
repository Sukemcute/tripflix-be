# TF05I — Trang quản trị dùng chung phiên đăng nhập với web (BE)

- Notion: chưa có task · Nhánh: `dung/TF05I-admin-dung-chung-phien-web` · Người làm: Dũng (dùng AI: có) · Ngày: 2026-11-17
- FE đi kèm: PR `tripflix-fe` nhánh cùng tên.

## Đã làm
- Nhân viên đang đăng nhập ở web mở trang quản trị không phải đăng nhập lại. Refresh token web gắn khoá trình duyệt theo origin (TF056), nên admin (origin khác, giữ token ở BFF) không dùng chung cookie được. Thay vào đó dùng mã chuyển phiên một lần:
  - `POST /api/auth/admin-handoff` (Bearer): chỉ moderator/superadmin, trả `{ code, expiresIn: 60 }`. Thành viên thường: 403.
  - `POST /api/auth/admin-handoff/exchange` (chế độ web, Origin trong `AUTH_WEB_ORIGINS`, chữ ký khoá trình duyệt): đổi mã lấy phiên mới gắn khoá của admin, đặt cookie refresh như đăng nhập.
- Mã lưu SHA-256 trong `access.registration_challenges` (khoá `admin-handoff:<userId>`), không thêm bảng hay migration. Dùng một lần (xoá có điều kiện), tạo mã mới thì mã cũ hết hiệu lực; khi đổi mã kiểm lại tài khoản còn hoạt động và còn là nhân viên.
- Thêm mã lỗi `forbidden` (403) cho `AccessError`.

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| Nhân viên đổi mã lấy phiên admin, vào được `/api/admin/me`, làm mới bằng khoá admin | Có | `web-cookie.e2e.spec.ts` › nhân viên đổi mã lấy phiên admin riêng |
| Mã dùng một lần, mã mới thay mã cũ | Có | › mã chỉ dùng một lần |
| Thành viên thường không lấy được mã | Có | › thành viên thường không tạo được mã: 403 |
| Bị hạ quyền sau khi tạo mã thì không đổi được | Có | › bị hạ quyền sau khi tạo mã |
| Chặn Origin lạ, thiếu chế độ web, thiếu chữ ký, mã sai dạng | Có | › đổi mã cần Origin tin cậy… |

## Kết quả kiểm tra
`pnpm turbo run lint typecheck test --filter=@tripflix/core-api`: 13/13 task xanh; core-api 127 file test pass (2 skipped), 2618 test pass (4 skipped). Lint 0 lỗi, không có cảnh báo ở file sửa.

## Cách kiểm lại
1. `pnpm --filter @tripflix/core-api exec vitest run src/modules/access/web-cookie.e2e.spec.ts`
2. Chạy cùng FE (PR đi kèm): đăng nhập web bằng tài khoản nhân viên, bấm "Mở trang quản trị".

## Ảnh / video
- Không đổi giao diện ở BE. Chưa chạy thử luồng đầy đủ trên máy (xem PR FE).

## Ảnh hưởng tới phần của người khác
- Không. Chỉ đụng `access` (Dũng) và `contracts/` sinh lại.
