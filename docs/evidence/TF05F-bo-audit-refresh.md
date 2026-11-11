# TF05F — Bỏ ghi audit cho mỗi lần refresh token

- Notion: chưa có · Nhánh: `dung/TF05F-bo-audit-refresh` · Người làm: Dũng (dùng AI: có) · Ngày: 2026-11-11

## Đã làm
- `rotateSession` không ghi dòng `auth.refresh` vào `access.audit_logs` nữa. Mỗi người dùng đang hoạt động refresh 15 phút một lần, nên bảng tăng khoảng 4 dòng mỗi giờ cho mỗi người và không có job dọn. Không có màn hình, test hay tài liệu nào đọc các dòng này. Lần dùng cuối của phiên vẫn còn ở `sessions.last_used_at`.
- Vẫn ghi `auth.refresh_reused` (nghi token bị trộm) và các hành động khác (login, logout, đổi mật khẩu...).
- Bỏ `'auth.refresh'` khỏi kiểu `AuditAction`. Các dòng cũ trong database giữ nguyên.

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| Refresh bình thường không ghi audit | Có | `auth.use-cases.spec.ts` "xoay vòng: cấp refresh token mới..." kiểm `auditRows` không có `auth.refresh` |
| Dùng lại token cũ vẫn ghi `auth.refresh_reused` | Có | `auth.use-cases.spec.ts` (test có sẵn) |
| Xoay vòng, grace, reuse không đổi hành vi | Có | Unit `AuthUseCases.refresh`, e2e `auth.e2e.spec.ts`, `web-cookie.e2e.spec.ts` |

## Kết quả kiểm tra
`pnpm turbo run lint typecheck test --affected`: 49/49 task pass; core-api 2090 test pass, 1 skip có sẵn. Lint core-api 0 lỗi, 85 cảnh báo (bằng develop).

## Cách kiểm lại
1. `pnpm --filter @tripflix/core-api exec vitest run src/modules/access/auth/application/auth.use-cases.spec.ts`

## Ảnh / video
- Không đổi giao diện.

## Ảnh hưởng tới phần của người khác
- Không. Chỉ sửa module `access`.
