# TF28: libs cho gợi ý bài viết (PR A): đăng nhập tuỳ chọn, stream và sự kiện tìm kiếm của discovery

- Notion: TF28 · Nhánh: `duy/TF28-libs-auth-su-kien-tim-kiem` · Người làm: Duy (dùng AI: có) · Ngày: 2026-11-12

## Đã làm
- `libs/auth`: thêm `OptionalAuthGuard`, `OptionalAuthenticated()`, `OptionalCurrentUser` cho route công khai có cá nhân hoá (discovery cần dùng). Các trường hợp không có token, token sai hoặc hết hạn, `sid` bị chặn, blocklist lỗi hoặc chờ quá `REVOCATION_CHECK_TIMEOUT_MS` đều coi như khách, không ném 401. Guard được đăng ký trong `AuthModule`. Tách hàm `isBlockedWithinTimeout` để `AccessTokenGuard` dùng chung; hành vi của `AccessTokenGuard` không đổi.
- `libs/event-bus`: thêm `STREAMS.discovery = 'stream:core.discovery'`, không đổi `CONSUMER_GROUPS`.
- `libs/contracts`: thêm `discovery.search.performed.v1` và `discovery.stays.searched.v1`. Hai schema chỉ giữ tín hiệu gu, không lưu nguyên câu tìm (`q`), không lưu GPS. Đã chạy `export-schemas` và commit 2 file trong `contracts/events/`.
- Không dùng `.strict()` vì các schema khác trong file cũng không dùng. Trường lạ như `q` bị bỏ đi khi parse. Bên phát (PR D) phải `parse` payload trước khi `publish`, vì event bus không tự kiểm payload.

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| Không token → cho qua, không gán `req.user` | Có | `guards.spec.ts` › OptionalAuthGuard › không token |
| Token hợp lệ → gán `req.user` | Có | › token hợp lệ |
| Token sai → khách, không 401 | Có | › token sai |
| `sid` bị chặn → khách | Có | › sid bị chặn |
| Blocklist lỗi hoặc treo → khách | Có | › blocklist lỗi; › blocklist treo (fake timer) |
| `AccessTokenGuard` giữ hành vi cũ | Có | Các test cũ của `AccessTokenGuard` vẫn pass |
| Guard có trong `AuthModule`, decorator trả đúng người dùng | Có | › OptionalAuthenticated, OptionalCurrentUser qua AuthModule (e2e supertest) |
| `STREAMS.discovery` | Có | Diff `libs/event-bus/src/index.ts` |
| Payload mẫu hợp lệ; thiếu `userId` bị từ chối; `q` bị bỏ | Có | `index.spec.ts` › TF28: sự kiện tìm kiếm của discovery |
| Tên sự kiện khớp regex phong bì | Có | › tên loại sự kiện khớp regex phong bì |
| Có JSON schema trong `contracts/events/` | Có | `discovery.search.performed.v1.schema.json`, `discovery.stays.searched.v1.schema.json` |

## Kết quả kiểm tra
- `pnpm turbo run lint typecheck test --affected`: 49/49 task thành công. auth 33 test, contracts 9, core-api 2202 pass (1 skip), notification-service 105. Lint 0 lỗi.
- Sau khi thêm test e2e: `pnpm turbo run lint typecheck test --filter=@tripflix/auth` 4/4 task, 35/35 test pass.

## Cách kiểm lại
1. `pnpm install --frozen-lockfile`
2. `pnpm --filter @tripflix/auth test` và `pnpm --filter @tripflix/contracts test`
3. `pnpm --filter @tripflix/contracts build && pnpm --filter @tripflix/contracts export-schemas`, rồi `git status` không thấy thay đổi nào.

## Ảnh / video
- Không đổi giao diện.

## Ảnh hưởng tới phần của người khác
- Có: `libs/` (chủ: Dũng, Dũng đã đồng ý phạm vi và sẽ review). Chỉ thêm, không đổi API cũ.
- Không sửa `content/`: bản `OptionalAuthGuard` trong `content/social/api/` giữ nguyên, Thành tự chuyển sang bản ở `libs/auth` sau.
