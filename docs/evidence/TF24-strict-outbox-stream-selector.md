# TF24 — Siết chặt Stream Selector cho Content Outbox Relay (Báo lỗi khi gặp loại sự kiện lạ)

- Notion: https://notion.so/tripflix/TF24 · Nhánh: `thanh/TF24-strict-outbox-stream-selector` · Người làm: Thành (Lê Quang Thành, dùng AI: có) · Ngày: 2026-11-05

## Đã làm
- **Siết chặt điều kiện định tuyến Stream trong `ContentOutboxRelay`**:
  - Theo thống nhất kiến trúc với anh Dũng (Lead / Auth) và anh Phong (Media), `ContentOutboxRelay` chỉ chuyển phát các sự kiện hợp lệ thuộc phân hệ Content:
    - Sự kiện media (`content.media.transcode_requested` hoặc `media.*`): định tuyến vào `STREAMS.media` (`stream:media`) để worker chuyển mã xử lý.
    - Sự kiện content (`content.*` như bài đăng `content.post.*`, bình luận `content.comment.*`, cảm xúc `content.reaction.*`): định tuyến vào `STREAMS.content` (`stream:core.content`).
    - Bất kỳ loại sự kiện lạ nào khác (ví dụ: `access.*`, `commerce.*`, `discovery.*`, hay sự kiện rác): ném lỗi `Error("Loại sự kiện không hợp lệ cho content outbox relay: ...")` thay vì âm thầm rơi vào fallback mặc định.
  - Ngăn ngừa tình trạng ghi nhầm event vào bảng outbox của content hoặc ô nhiễm `stream:core.content`.
- **Kiểm thử tự động**:
  - Bổ sung 2 test assertions trong `apps/core-api/src/modules/content/social/infra/content-outbox-relay.spec.ts` kiểm tra ném lỗi chính xác khi gặp `access.user.registered` và `unknown.custom_event`.

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| Stream selector ném lỗi rõ ràng khi gặp event lạ | Đạt | `apps/core-api/src/modules/content/social/infra/content-outbox-relay.ts` |
| Bổ sung unit test kiểm tra ném ngoại lệ khi gặp event lạ | Đạt | `apps/core-api/src/modules/content/social/infra/content-outbox-relay.spec.ts` |
| Không vi phạm ranh giới module, không dính lỗi lint/typecheck/test | Đạt | `node tools/check-boundaries.mjs` (0 vi phạm), `pnpm lint` (0 errors), `pnpm typecheck` (pass 100%), `pnpm test` (38 test files, 283/283 tests pass) |

## Kết quả kiểm tra
- `node tools/check-boundaries.mjs`: Ranh giới module: không có vi phạm.
- `pnpm lint`: 22 tasks successful, 0 errors.
- `pnpm typecheck`: 22 tasks successful (Pass 100%).
- `pnpm --filter @tripflix/core-api test -- content-outbox-relay.spec.ts`: 2/2 tests pass.
- `pnpm test`: 22 tasks successful across 13 packages.

## Cách kiểm lại
1. `cd tripflix-be`
2. `node tools/check-boundaries.mjs`
3. `pnpm --filter @tripflix/core-api test -- content-outbox-relay.spec.ts`
4. `pnpm typecheck`

## Ảnh hưởng tới phần của người khác
- Giữ an toàn dữ liệu và phân tách stream sạch sẽ theo đúng kiến trúc microservices/modular monolith.
- Đã đồng bộ với PR #31 của anh Phong (Media) vừa được merge.
