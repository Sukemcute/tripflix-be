# TFxx — Ẩn preflight CORS thành công khỏi danh sách trace mặc định

- Task: yêu cầu trực tiếp trong Codex, chưa có link Notion.
- Nhánh: `trang/TFxx-an-preflight-traces`. Ngày: 2026-11-17. Người làm: Trang (dùng AI).

## Đã làm và nghiệm thu

- Phân loại OPTIONS có header preflight và response CORS hợp lệ, HTTP 2xx; không đưa giá trị header vào telemetry.
- Mặc định lọc theo root trace trước giới hạn 50, tránh span con làm trace lọt bộ lọc. `includeSuccessfulPreflights=true` cho xem lại.
- Giữ nguyên metrics, sampling, lưu trữ span, API chi tiết theo ID và bộ lọc service/lỗi/độ trễ.
- Không phân loại hồi tố OPTIONS unmatched cũ. HTTP lỗi và response 2xx từ chối CORS vẫn hiện.

## Kết quả kiểm tra

- `pnpm turbo run lint typecheck test --affected`: 49 task thành công.
- Observability: 14 test pass; Analytics observability: 15 test pass.
- `pnpm turbo run build --filter=@tripflix/core-api...`, `pnpm contracts:build`: pass.
- Tempo 2.9 thật, dữ liệu fixture cô lập: 7 trace khi bật xem tất cả, 6 mặc định, 1 trace lỗi; bộ lọc độ trễ pass. Fixture thành công có span SQL con vẫn bị ẩn.
- `node tools/verify-preflight-traces.mjs`: pass. Cần core-api đã build và Tempo cô lập tại loopback 3215/4319; không dùng trên staging/production. Xóa container test sau mỗi lần chạy để không trùng fixture.

## Phạm vi và triển khai

- Analytics (Trang), `libs/observability` (Dũng), hợp đồng OpenAPI được sinh lại. Không sửa deploy của Phong, database hay migration.
- Cần BE mới để phân loại trace mới và hỗ trợ query, FE mới để hiện checkbox. Chưa triển khai staging trong task này; Phong giữ quyền server.
- UI được kiểm thử ở PR FE liên quan, bằng fixture Tempo thật qua API service và BFF được thay bằng adapter kiểm thử.
