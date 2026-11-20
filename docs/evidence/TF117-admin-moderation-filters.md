# TF117 — Bộ lọc hàng đợi kiểm duyệt Admin

- Jira: [SCRUM-188](https://tripflix.atlassian.net/browse/SCRUM-188) · Nhánh: `trang/TF117-admin-ui-redesign` · Người làm: Trang (dùng AI: có) · Ngày: 2026-11-20

## Đã làm

- Thêm tham số tương thích ngược `sort=priority|newest` và `priority=all|high` cho API hàng đợi admin.
- Sắp theo thời điểm tạo của nội dung đích khi chọn mới nhất; cursor giữ ổn định thứ tự và từ chối cursor dùng sai kiểu sắp xếp.
- Lọc ưu tiên cao theo `URGENT_SEVERITY` hiện có.
- Sinh OpenAPI từ DTO/controller; không sửa tay hợp đồng.

## Đối chiếu tiêu chí

| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| API có sort/filter và giữ mặc định ưu tiên | Có | `contracts/openapi/core-api.json`; test HTTP |
| Bình luận mới nhất lên đầu, phân trang cursor liên tục | Có | Test tích hợp PostgreSQL thật: 1/1 |
| Ưu tiên cao dùng ngưỡng hiện có | Có | Test HTTP xác nhận `minSeverity: 80` |

## Kết quả kiểm tra

- `pnpm contracts:build` — pass.
- `pnpm --filter @tripflix/core-api lint` — exit 0; có cảnh báo sẵn ngoài moderation.
- `pnpm --filter @tripflix/core-api exec -- vitest run --config vitest.int.config.ts src/modules/content/moderation/application/moderation.int.spec.ts -t "lọc mức ưu tiên cao"` — 1 pass.
- `pnpm --filter @tripflix/core-api exec -- vitest run src/modules/content/moderation/api/moderation.e2e.spec.ts -t "lọc tab lưu trữ"` — 1 pass.
- `pnpm --filter @tripflix/core-api typecheck` — chưa pass do lỗi có sẵn tại `feed/infra/trend-signals.consumer.ts`: `core-feed-trend` không thuộc union `ServiceName`.

## Cách kiểm lại

1. Gọi `GET /v1/admin/moderation/queue?targetType=comment&sort=newest`.
2. Dùng `priority=high` để chỉ lấy hồ sơ từ severity 80 trở lên.
3. Dùng `nextCursor` cho trang tiếp theo; giữ nguyên `sort` và filter.

## Ảnh / video

- Không áp dụng cho API backend.

## Ảnh hưởng tới phần của người khác

- Không đổi schema database hoặc API hiện có; chỉ bổ sung query params.
