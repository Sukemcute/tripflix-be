# TF05E — JWKS hỗ trợ nhiều kid khi đổi khoá ký

- Notion: chưa có · Nhánh: `dung/TF05E-ho-tro-nhieu-kid` · Người làm: Dũng (dùng AI: có) · Ngày: 2026-11-11

## Đã làm
- Thêm `AUTH_JWT_PREVIOUS_JWKS`: dán nguyên JSON `GET /.well-known/jwks.json` của khoá cũ. core-api ký bằng khoá mới, JWKS công bố cả khoá cũ, nên access token cũ còn hạn (tối đa 15 phút) vẫn qua khi đổi khoá. Trước đây đổi khoá là mọi token cũ bị `401` ngay.
- Env từ chối JSON hỏng, khoá có `d` (khoá riêng), thiếu `kid`, danh sách rỗng. Khoá cũ trùng `kid` với khoá đang ký: core-api dừng lúc khởi động.
- README module access: 3 bước đổi khoá. notification-service không đổi: `createRemoteJWKSet` tự tải lại JWKS khi gặp `kid` lạ.

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| Token khoá cũ còn hạn vẫn kiểm được sau khi đổi khoá | Có | `jose-token-issuer.spec.ts` "ký bằng khoá mới, vẫn kiểm được token còn hạn của khoá cũ" |
| Bỏ khoá cũ thì token khoá cũ bị từ chối | Có | `jose-token-issuer.spec.ts` "bỏ khoá cũ thì token của khoá cũ bị từ chối" |
| Cấu hình sai bị chặn lúc khởi động | Có | `env.spec.ts` "AUTH_JWT_PREVIOUS_JWKS", `jose-token-issuer.spec.ts` "trùng kid" |

## Kết quả kiểm tra
`pnpm turbo run lint typecheck test --affected`: 49/49 task pass; core-api 2094 test pass, 1 skip có sẵn. Lint core-api 0 lỗi, 85 cảnh báo (bằng develop, không có ở file đã sửa).

## Cách kiểm lại
1. `pnpm --filter @tripflix/core-api exec vitest run src/platform/env.spec.ts src/modules/access/auth/infra/jose-token-issuer.spec.ts`

## Ảnh / video
- Không đổi giao diện.

## Ảnh hưởng tới phần của người khác
- Không. Chỉ sửa module access và `apps/core-api/src/platform/env.ts` (thêm biến, thu hẹp kiểu key trong `dbUrlOf`, không đổi hành vi).
