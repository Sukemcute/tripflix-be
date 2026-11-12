# TF05G — Giới hạn tuổi phiên và email báo token bị dùng lại

- Notion: chưa có · Nhánh: `dung/TF05G-gioi-han-phien-va-bao-dung-lai` · Người làm: Dũng (dùng AI: có) · Ngày: 2026-11-11

## Đã làm
- **Tuổi tối đa của phiên 180 ngày.** Trước đây mỗi lần refresh tính lại hạn 30 ngày, nên phiên refresh đều sống mãi; ai cầm được refresh token giữ được phiên cho tới khi chủ thật mở app. Giờ hạn mới khi xoay vòng là `min(now + 30 ngày, created_at + 180 ngày)` (`nextRefreshExpiry`). Quá mốc thì nhánh `invalid` có sẵn trả `401`, job dọn phiên có sẵn xoá dòng. Không đổi schema: dùng cột `sessions.created_at` đã có.
- **Email khi token bị dùng lại.** Khi phát hiện refresh token cũ bị dùng lại (`reuse`), access ghi sự kiện `access.session_reuse_detected` v1 `{ userId, email, displayName, deviceName }` vào outbox, cùng transaction với việc xoá phiên và ghi audit. notification-service gửi thư "Phiên đăng nhập Tripflix của bạn đã bị đăng xuất", kèm link đăng nhập lại và đặt lại mật khẩu (đặt lại huỷ mọi phiên còn lại).
- Hai request dùng lại cùng lúc: chỉ request xoá được phiên mới ghi audit và phát sự kiện, nên không gửi hai thư.
- `SessionRecord` thêm `deviceName`, `createdAt` (đọc từ cột có sẵn). Sinh lại `contracts/events/access.session_reuse_detected.v1.schema.json`. Cập nhật README của `access` và `notification-service`.

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| Phiên quá 180 ngày kể từ lúc đăng nhập không làm mới được | Có | `auth.use-cases.spec.ts` "phiên quá 180 ngày kể từ lúc đăng nhập..." |
| Dùng lại token cũ thì phát đúng một sự kiện báo | Có | `auth.use-cases.spec.ts` "dùng lại token cũ sau 10 giây..." |
| notification-service gửi thư, giao lại không gửi lần hai | Có | `event-router.spec.ts` "access.session_reuse_detected...", `session-reuse.email.spec.ts` |
| Xoay vòng, grace, reuse hiện có không đổi hành vi | Có | Unit `AuthUseCases.refresh`, e2e access |

## Kết quả kiểm tra
`pnpm turbo run lint typecheck test --affected`: 49/49 task pass; core-api 2108 test pass, 1 skip có sẵn; notification-service 76 test pass; contracts 4 test pass. Lint 0 lỗi; core-api 87 cảnh báo (bằng develop, không có ở file đã sửa).

## Cách kiểm lại
1. `pnpm --filter @tripflix/core-api exec vitest run src/modules/access/auth/application/auth.use-cases.spec.ts`
2. `pnpm --filter @tripflix/notification-service exec vitest run src/consumers/event-router.spec.ts src/outapp/session-reuse.email.spec.ts`

## Ảnh / video
- Không đổi giao diện. Thư mới chưa gửi thử qua SMTP thật.

## Ảnh hưởng tới phần của người khác
- Không. Chỉ sửa `access`, `notification-service`, `libs/contracts` (thêm sự kiện mới, không đổi sự kiện cũ).
