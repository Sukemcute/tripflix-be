# TF45 — Chia sẻ lên mạng xã hội và deep link

- Notion: https://notion.so/tripflix/TF45 · Nhánh: `thanh/TF02-social-content` · Người làm: Thành (Lê Quang Thành, dùng AI: có) · Ngày: 2026-11-04

## Đã làm
- Hiện thực API ghi nhận sự kiện chia sẻ và sinh liên kết điều hướng sâu (`POST /v1/posts/:id/shares`).
- Hỗ trợ các nền tảng chia sẻ: `facebook`, `zalo`, `twitter`, `copy_link`.
- Tự động sinh `deepLink` theo định dạng scheme di động `tripflix://posts/{id}` và URL chuẩn web `https://tripflix.vn/posts/{id}`.
- Tự động tăng bộ đếm `share_count` nguyên tử trong cơ sở dữ liệu và phát sự kiện Outbox `content.post.shared` sang Redis Streams để ghi nhận phân tích dữ liệu tương tác người dùng.

## Đối chiếu "Xong khi"
| Tiêu chí (chép từ Notion) | Đạt | Bằng chứng (tên test, lệnh, ảnh, link) |
|---|---|---|
| Hỗ trợ ghi nhận chia sẻ qua nhiều nền tảng (facebook, zalo, twitter, copy_link) | Đạt | `TrackShareUseCase`, `social.controllers.spec.ts` test "POST /posts/:id/shares" pass |
| Sinh URL deep link chuẩn hỗ trợ cả web và mobile app scheme | Đạt | `TrackShareUseCase` sinh `tripflix://posts/{id}` và `https://tripflix.vn/posts/{id}` |
| Cập nhật bộ đếm share_count và phát sự kiện `content.post.shared` | Đạt | Test `social-use-cases.spec.ts` pass |
| 100% Lint, Typecheck, Unit Test pass | Đạt | `pnpm check` (62/62 tests pass) |

## Kết quả kiểm tra
- `pnpm lint`: 0 warnings, 0 errors.
- `node tools/check-boundaries.mjs`: Ranh giới module: không có vi phạm.
- `pnpm typecheck`: Thành công trên toàn bộ workspace monorepo.
- `pnpm test`: 62/62 tests pass.

## Cách kiểm lại
1. `cd tripflix-be`
2. `pnpm check`

## Ảnh / video
- Đợt cập nhật Backend Core API & Contracts: Không thay đổi giao diện frontend.

## Ảnh hưởng tới phần của người khác
- Không: Phát sự kiện chuẩn `EventEnvelope` qua Redis Streams.
