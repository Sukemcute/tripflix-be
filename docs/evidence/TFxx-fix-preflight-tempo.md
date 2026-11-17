# TFxx — Sửa truy vấn Tempo khi bật xem preflight

- Task: yêu cầu trực tiếp trong Codex, chưa có link Notion · Nhánh: `trang/TFxx-fix-preflight-tempo` · Người làm: Trang (dùng AI) · Ngày: 2026-11-17

## Đã làm

- Khi bật xem preflight và không có bộ lọc nào khác, thay selector TraceQL rỗng bằng `duration >= 0ms`, điều kiện hợp lệ bao gồm mọi trace.
- Fixture integration dùng service name ngẫu nhiên để nhiều lần chạy trên cùng Tempo không trộn dữ liệu.

## Kết quả kiểm tra

- Analytics observability: 10/10 test pass.
- `pnpm turbo run lint typecheck --filter=@tripflix/core-api --filter=@tripflix/observability`: 14 tác vụ thành công.
- Build observability/core-api và integration script Tempo 2.9 pass; 7 trace khi bật xem tất cả, 6 trace mặc định, 1 trace lỗi. Kiểm tra truy vấn show-all không filter trả trạng thái ready.

## Cách kiểm lại

1. Build `pnpm turbo run build --filter=@tripflix/core-api...`.
2. Chạy Tempo cô lập trên loopback 3215/4319 theo `deploy/observability/tempo.yaml`.
3. Chạy `node tools/verify-preflight-traces.mjs`.

## Ảnh hưởng

- Analytics của Trang; không đổi API, schema, compose hay cấu hình staging. Phải deploy backend để sửa trạng thái staging.
