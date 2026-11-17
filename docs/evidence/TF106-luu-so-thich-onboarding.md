# TF106 — Lưu sở thích onboarding vào hồ sơ người dùng

- Jira: [SCRUM-171](https://tripflix.atlassian.net/browse/SCRUM-171) (mobile: SCRUM-160) · Nhánh: `duy/TF106-luu-so-thich-onboarding` · Người làm: Duy (dùng AI: có) · Ngày: 2026-11-17

## Đã làm
- Thêm trường tuỳ chọn `travelPreferences` vào hồ sơ: `GET /api/auth/me` trả về (null khi chưa làm khảo sát), `PATCH /api/auth/me` lưu hoặc xoá (gửi `null`). Không có endpoint mới.
- Dạng `{ status: completed|skipped, interests: (coast|nature|culture|food|city|stays)[], regions: (north|central|highlands|south)[], budgetLevels: (saving|moderate|premium)[], updatedAt }`, validate zod ở `account/api/dto.ts`; mã ở `account/domain/travel-preferences.ts`.
- Chỉ hỏi thứ giúp gợi ý điểm đến: không có nhịp đi, đi cùng ai, số người.
- Bản gửi lên có `updatedAt` cũ hơn bản đang lưu thì giữ bản đang lưu (khách làm khảo sát trên máy rồi mới đăng nhập không đè bản mới hơn).
- Cột `access.users.travel_preferences jsonb null`, migration `20261117034509_add_user_travel_preferences` (một lệnh `ADD COLUMN`).
- Chỉ lưu: chưa module nào đọc, không lên event bus, audit chỉ ghi tên trường như các trường cá nhân khác.

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| PATCH lưu, GET trả đúng; không đổi trường hồ sơ khác | Có | `account.e2e.spec.ts` › TF106 |
| Mã lạ, trùng (`interests`, `regions`, `budgetLevels`), sai `status`/`updatedAt`, thừa trường (vd `pace`) hoặc thiếu trường → 400 | Có | như trên |
| `updatedAt` cũ hơn không đè, không ghi audit | Có | như trên; `travel-preferences.spec.ts` (so theo thời điểm, có múi giờ) |
| `null` xoá | Có | như trên |
| Client không gửi trường này thì hành vi cũ giữ nguyên | Có | các test TF055/TF06M cũ vẫn pass |

## Kết quả kiểm tra
- `vitest run account.e2e.spec.ts travel-preferences.spec.ts`: 2 file, 11 test pass.
- core-api `vitest run --maxWorkers=2`: 130 file pass, 2 skip; 2630 test pass, 4 skip. `pnpm typecheck` sạch. `oxlint --type-aware` trên các file đổi: 0 lỗi.
- core-api `pnpm test:int` (Postgres, Redis thật qua Testcontainers): 25 file, 202 test pass. Lần đầu CI fail ở `drizzle-access.store.int.spec.ts` › TF06M vì `personal` có thêm `travelPreferences: null`; đã thêm trường đó vào kết quả mong đợi, không nới test.
- `pnpm turbo run lint typecheck test --affected` trên máy 16 GB đang chạy Docker: các lib và notification-service pass; core-api và `oxlint` cả `src` hết RAM, nên chạy riêng như trên. video-worker chạy riêng: 49/49 pass.

## Cách kiểm lại
1. `pnpm stack:be`, chạy migration. Swagger: `http://localhost:8080/docs`.
2. Đăng nhập, `PATCH /api/auth/me` với `{"travelPreferences":{"status":"completed","interests":["coast","food"],"regions":["central"],"budgetLevels":["moderate"],"updatedAt":"2026-11-17T10:00:00.000Z"}}`.
3. `GET /api/auth/me` thấy `travelPreferences`; PATCH lại với `updatedAt` cũ hơn thì giá trị không đổi.

## Ảnh / video
- Không đổi giao diện.

## Ảnh hưởng tới phần của người khác
- Có: module `access` (chủ Dũng, Duy backup). Dũng đã đồng ý 17/11 (thêm cột vào `users`). Chỉ thêm trường tuỳ chọn trong DTO và `contracts/openapi/core-api.json`; client web/admin/mobile cũ không bị ảnh hưởng.
- Test có sẵn của `access` chỉ thêm `travelPreferences: null` vào kết quả mong đợi: `validation.e2e.spec.ts`, `web-cookie.e2e.spec.ts`, `drizzle-access.store.int.spec.ts`.
