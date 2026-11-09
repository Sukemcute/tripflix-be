# TF29: giới hạn thời gian chờ khoá khi giữ chỗ

- Notion: chưa có link · Người làm: Thắng (dùng AI: có) · Ngày: 2026-11-09 · Nhánh: `thang/TF29-gioi-han-cho-khoa-giu-cho`

## Đã làm
- Transaction giữ chỗ đặt `lock_timeout` 2 giây; quá hạn trả 409, `reason: LOCK_TIMEOUT`.
- Không áp dụng cho `applyResult`, vì lúc đó tiền đã trừ.

## Kết quả kiểm tra
- `checkout.int.spec.ts` trên Postgres thật: 23/23, có test mới giữ khoá dòng rồi đặt chỗ: 409, không giữ chỗ, nhả khoá xong đặt được.
- Unit commerce 64/64; lint, typecheck core-api pass.

## Cách kiểm lại
1. `pnpm --filter @tripflix/core-api exec vitest run --config vitest.int.config.ts src/modules/commerce/checkout.int.spec.ts`

## Ảnh hưởng tới phần của người khác
- Không.
