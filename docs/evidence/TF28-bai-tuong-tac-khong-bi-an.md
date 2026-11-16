# TF28 — Bài đã tương tác không biến mất khỏi gợi ý; tầng chính sách theo người xem

- Notion/Jira: chưa cung cấp link task · Nhánh: `duy/TF28-bai-tuong-tac-khong-bi-an` · Người làm: Duy (dùng AI: có) · Ngày: 2026-11-16

## Bug

Người dùng đăng nhập thả tim một bài thì từ lượt tải feed sau bài đó biến mất khỏi `GET /api/recommendations/posts` và không bao giờ quay lại. Kho ít bài thì feed hụt bài thấy rõ.

Nguyên nhân: `listInteractedPostIds` (mọi bài đã tương tác, kể cả bài tự đăng qua dòng `publish`) được đưa vào `notInArray` trong SQL của cả ba nguồn ứng viên. Bài chỉ quay lại khi bỏ tim hoặc khi job dọn bảng thô xoá dòng tương tác (180 ngày). Gốc rễ rộng hơn: luật "bài này xếp đâu với người này" nằm rải rác, mỗi chỗ một kiểu (loại trong SQL, đẩy cuối ở use case, dồn cuối trong ranker).

## Đã làm

- **Tầng chính sách** `recommend/domain/feed-policy.ts` (hàm thuần): không bỏ bài nào, chỉ nhân hệ số / cộng điểm rồi sắp lại; hệ số đã áp ghi vào `breakdown`.
  - Đã gợi ý ở phiên trước ×0.1 · đã tương tác ×0.2 (trừ bài tự đăng) · bài thứ n ≥ 3 của cùng tác giả ×0.5^(n−2) · bài tự đăng trong 1 giờ +10.
  - Hệ số là giá trị giữ chỗ, chỉnh bằng bộ đánh giá offline.
- **Ranker** chỉ chấm điểm phù hợp; luật tối đa 2 bài/tác giả (dồn cuối) chuyển sang tầng chính sách thành phạt điểm.
- **Nguồn ứng viên** hot/fresh không còn loại bài theo lịch sử người dùng; explore vẫn bỏ bài đã tương tác (dành cho bài mới).
- **Nguồn `own`**: `listOwnRecentPostIds` đọc dòng `publish` của bảng thô, nên bài vừa đăng lên đầu feed của **chính người đăng** ngay, không chờ job 10 phút; người khác thấy bài đó như bài thường.
- **Mọi tín hiệu người xem chốt theo lúc tải trang đầu** (`sessionAt` trong cursor): thả tim giữa phiên không làm trang sau lặp/mất bài.
- **API chỉ thêm giá trị**: `reason.code` thêm `own_post`, `source` thêm `own`; mô tả endpoint cập nhật. `contracts/openapi/core-api.json` sinh lại.
- Thiết kế ghi ở `docs/proposals/recommend-offline-architecture.md` mục 6.3 (thư mục tài liệu root của Duy, ngoài repo). README `discovery` cập nhật.

## Đối chiếu "Xong khi"

| Tiêu chí (từ báo lỗi và quyết định của Duy 16/11) | Đạt | Bằng chứng |
|---|---|---|
| Bài đã thả tim vẫn còn trong feed (hạ điểm, không bị bỏ), kho ít bài vẫn hiện | ✅ | `post-recommendations.use-cases.spec.ts` › "bài đã thả tim không biến mất…" (fail trên code cũ, pass trên code mới) |
| Thả tim giữa phiên không làm trang sau xô lệch | ✅ | spec › "thả tim giữa phiên: trang sau không xô lệch…" (fail trên code cũ) |
| Không luật theo người xem nào loại bài; mọi luật ở một chỗ | ✅ | `feed-policy.spec.ts` (7 test): đã xem/đã tương tác chỉ bị phạt, đa dạng tác giả phạt chứ không dồn cuối, bài bị phạt không chiếm suất tác giả |
| Bài tự đăng gần đây lên đầu feed của chính tác giả, ngay khi đăng; người khác thấy như bài thường | ✅ | spec › "bài vừa tự đăng (chưa qua job) lên đầu…", "bài tự đăng đã là ứng viên…", "khách không đọc bài tự đăng"; `feed-policy.spec.ts` › "người khác không được cộng…" |
| `listOwnRecentPostIds` đúng người, đúng cửa sổ, bỏ dòng đã gỡ, lọc loại bài | ✅ | `drizzle-recommend.store.int.spec.ts` › "bài tự đăng gần đây…" (Postgres thật) |
| Đổi API chỉ thêm giá trị, contracts sinh lại | ✅ | `pnpm contracts:build`; diff `core-api.json` chỉ thêm `own_post`, `own` và mô tả |
| Chấp nhận, không sửa: feed có điểm dừng (~200 ứng viên), kho lớn có bài không vào ứng viên | — | Duy chốt 16/11 |

## Kết quả kiểm tra

- `pnpm turbo run lint typecheck test --affected`: **49/49 task pass**. core-api: 105 file test pass, 2 skip có sẵn (2399 test pass, 4 skip). Lint 0 lỗi; 109 cảnh báo có sẵn, không có cảnh báo trong file đã sửa.
  - Một lần chạy turbo trước đó có 5 file test fail; chạy lại (riêng core-api và qua turbo) đều pass, không tái hiện. Nghi test chập chờn khi máy tải nặng, chưa xác định file.
- `pnpm --filter @tripflix/core-api test:int` phần discovery (`vitest run --config vitest.int.config.ts src/modules/discovery`): **3 file, 16 test pass** (store gợi ý 10/10).
- 3 test mới ở use case chạy trên code cũ: **fail cả 3**, xác nhận tái hiện bug.

## Cách kiểm lại

1. `pnpm install && pnpm turbo run lint typecheck test --affected`
2. Có Docker: `cd apps/core-api && npx vitest run --config vitest.int.config.ts src/modules/discovery`
3. Chạy stack (`pnpm stack:up`), đăng nhập, thả tim một bài trong feed gợi ý, tải lại: bài vẫn còn (xuống thấp hơn). Đăng một bài mới: tải lại feed thấy bài ở đầu (`reason.code = own_post`); tài khoản khác không thấy bài đó ở đầu.

## Ảnh / video

- Không đổi giao diện. FE muốn hiện lý do `own_post` thì chạy `pnpm gen:api`.

## Ảnh hưởng tới phần của người khác

- Không. Chỉ sửa trong `discovery` (Duy) và file sinh `contracts/openapi/core-api.json` (chỉ thêm giá trị enum).
- Chưa đồng bộ: `experiments/recommend/rec/gen/simulate.py` (thử nghiệm offline, ngoài repo) vẫn loại cứng bài đã tương tác; cần sửa trước khi dùng bộ đánh giá để chỉnh hệ số.
