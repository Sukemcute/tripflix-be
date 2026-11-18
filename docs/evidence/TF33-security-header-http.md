# TF33 — Header bảo mật HTTP cho core-api

- Notion: TF33 · Nhánh: `thanh/TF33-security-header-http` · Người làm: Thành (dùng AI: có) · Ngày: 2026-11-18

## Đã làm
- `apps/core-api/src/platform/http.ts`: thêm `applySecurityHeaders`, gọi trong `setupHttp` trước prefix và CORS, nên mọi phản hồi (thành công, lỗi, 404 không có route, preflight CORS) đều có:
  - `X-Frame-Options: DENY`: trang khác không nhúng được API, Swagger vào iframe (clickjacking).
  - `X-Content-Type-Options: nosniff`: trình duyệt không đoán lại kiểu nội dung.
  - `Referrer-Policy: strict-origin-when-cross-origin`: sang site khác chỉ gửi origin, không lộ đường dẫn có id.
  - `Strict-Transport-Security: max-age=31536000; includeSubDomains`: chỉ gọi qua HTTPS trong 1 năm.
- Khác bản nháp 12/11 (nhánh `thanh/TF33-security-header-va-statement-timeout`, chưa từng push):
  - Bỏ `statement_timeout` 15s cho mọi pool: develop đã có cách làm tốt hơn của Thắng (`2d367b6`, 10s, chỉ pool của app, không áp cho migrate/seed/CLI).
  - Bỏ `X-XSS-Protection`: trình duyệt đã bỏ bộ lọc này, OWASP khuyên không dùng.
  - HSTS không có `preload`: vào danh sách preload thì rất khó rút ra, để Tech Lead quyết.

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| Mọi phản hồi có header chống clickjacking, MIME sniffing, HSTS | Đạt | `http.e2e.spec.ts`: 200, 404 do controller, 404 không có route |
| CORS của web không bị ảnh hưởng | Đạt | `http.e2e.spec.ts` "preflight CORS của web vẫn chạy" (204, đúng origin) |
| Không dùng header lỗi thời | Đạt | `http.e2e.spec.ts` "không gửi X-XSS-Protection, HSTS không có preload" |

## Kết quả kiểm tra
- `pnpm --filter @tripflix/core-api exec vitest run src/platform/http.e2e.spec.ts`: 4/4 pass.
- `pnpm turbo run lint typecheck test --affected`: lint, typecheck pass; lần đầu `@tripflix/core-api#test` có 3 file fail, chạy lại không lặp lại được.
- `pnpm turbo run test --filter=@tripflix/core-api --force`: 11/11 task; core-api 153 file pass, 2 skip (2.804 test pass).

## Cách kiểm lại
1. `pnpm --filter @tripflix/core-api exec vitest run src/platform/http.e2e.spec.ts`
2. Chạy core-api rồi `curl -sI http://localhost:3000/health`: có 4 header trên.

## Ảnh / video
- Không đổi giao diện.

## Ảnh hưởng tới phần của người khác
- Có: `apps/core-api/src/platform/http.ts` (Dũng sửa gần nhất, phần CORS). Chỉ thêm hàm mới và một dòng gọi trong `setupHttp`, không đổi `applyCors`, `applyGlobalPrefix`. Cần báo Dũng duyệt.
