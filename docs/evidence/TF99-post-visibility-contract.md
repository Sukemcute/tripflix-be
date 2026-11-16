# TF99 — Thêm postVisibility vào sự kiện bình luận (phần contract)

- Notion: TF99 · Nhánh: `dung/TF99-post-visibility-contract` · Người làm: Dũng (dùng AI: có) · Ngày: 2026-11-16

## Đã làm
- Thêm `PostVisibilitySchema` (`public` | `private`) trong `libs/contracts`.
- Thêm field tuỳ chọn `postVisibility` vào 5 sự kiện: `content.comment.created`, `updated`, `deleted`, `hidden`, `restored` (v1). Tuỳ chọn để sự kiện đang nằm trong outbox và stream vẫn hợp lệ.
- Chạy `pnpm contracts:build`: chỉ 5 file `contracts/events/content.comment.*.v1.schema.json` đổi, OpenAPI không đổi.
- Đây là bước đầu của TF99: anh Thành ghi field này bên core, sau đó notification-service chỉ phát `post.comments.changed` khi `postVisibility === 'public'` (thiếu field thì không phát).

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| 5 sự kiện bình luận có field tuỳ chọn `postVisibility` (public, private) | Có | `libs/contracts/src/index.spec.ts` — "TF99: postVisibility trong sự kiện bình luận" |
| Sự kiện cũ không có field vẫn parse được | Có | cùng test, ca "nhận sự kiện cũ không có postVisibility" |
| Đã chạy `pnpm contracts:build` và commit `contracts/` | Có | 5 file JSON schema trong commit `feat(contracts)` |

## Kết quả kiểm tra
- `pnpm --filter @tripflix/contracts test`: 19/19 pass (thêm 10 ca mới).
- `pnpm turbo run lint typecheck test --affected --continue --concurrency=2`: 49/49 task pass.
- Lần chạy đầu với concurrency mặc định, `notification-service#test` dừng vì lỗi Vitest "Failed to terminate forks worker" (lỗi của Vitest trên máy, không phải test fail). Chạy lại riêng: 16 file, 112 test pass.

## Cách kiểm lại
1. `pnpm --filter @tripflix/contracts test`
2. `pnpm contracts:build` rồi `git status`: không có file nào đổi thêm.

## Ảnh / video
- Không đổi giao diện.

## Ảnh hưởng tới phần của người khác
- Chỉ thêm field tuỳ chọn, không đổi field cũ. Người dùng các sự kiện này: notification-service (Dũng), content/social phát sự kiện (Thành, sẽ ghi field), tripflix-ai đọc `content.comment.*` (Bảo) — không phải sửa gì, khi sinh lại `app/contracts/` sẽ có thêm field tuỳ chọn.
