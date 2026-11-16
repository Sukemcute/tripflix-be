# TF23 — Điểm xu hướng hot@v1 và gợi ý Reels (phần discovery)

- Jira: [SCRUM-27](https://tripflix.atlassian.net/browse/SCRUM-27) · Nhánh: `duy/TF23-diem-xu-huong-reels` · Người làm: Lê Anh Duy (dùng AI: có) · Ngày: 2026-11-16
- Chia việc (đã thống nhất với Phong 16/11): Duy làm điểm xu hướng; Phong làm chống lặp theo lượt xem, sự kiện lượt xem/bấm khách sạn và phía Reels.

## Đã làm
- **Bộ chấm `hot@v1`** (`domain/builders/hot.ts`), giữ `hot@v0` để so:
  - Tín hiệu = Σ trọng số loại × trọng số tài khoản: tim 1, bình luận 3, lưu 4, chia sẻ 5, đặt theo lộ trình (`order_item` có `sourcePostId`) 10.
  - Tài khoản dưới 7 ngày tuổi hạ trọng số tuyến tính, sàn 0,2 (tuổi lấy từ dòng `registered`).
  - Có lượt xem (`kind: 'view'`) thì chia `(lượt xem + 20)`; chưa có sự kiện lượt xem thì bỏ mẫu, nên bật lên khi Phong bắn `content.post.viewed` mà không phải sửa công thức.
  - Video cũ tụt dần như v0: chia `(giờ tuổi + 2)^1.2`, chuẩn hoá theo p99 cả lô.
- **Truy vấn tương tác gom trong SQL** (`listPostInteractionSamples`): một câu, nối dòng `registered` lấy tuổi tài khoản, gom theo (bài, loại, số ngày tuổi chặn ở 7). Không kéo từng dòng vào bộ nhớ khi có lượt xem.
- **Migration `20261116074215_use_hot_v1`**: dòng `trending` và `for_you` của `recommend_algos` dùng `hot@v1`; hai ranker nhận thêm `hot@v1`; bộ ba dự phòng cũng dùng `hot@v1`.
- **`GET /api/recommendations/reels`** (`mode` = `trending` | `for_you`, `limit`, `cursor`): xếp hạng bài `video` rồi lấy thẻ phát được qua `content/feed`, giữ đúng thứ tự, một request cho app. Chống lặp hiện theo "đã gợi ý" cho người đăng nhập (Phong chấp nhận tạm). **Trả 503 cho tới khi nối `FeedFacade.getByIds`** (Phong export ở `content/index.ts`).
- Sinh lại `contracts/openapi/core-api.json`.

## Đối chiếu "Xong khi"
| Tiêu chí (Jira) | Đạt | Bằng chứng |
|---|---|---|
| Thứ hạng khớp bộ dữ liệu thử | Có | `hot-v1.spec.ts` › bộ dữ liệu thử 8 video với thứ hạng định trước; ca có lượt xem |
| Lưu / đặt theo lộ trình nhiều hơn thì xếp trên | Có | `hot-v1.spec.ts`; `drizzle-recommend.store.int.spec.ts` › lấy cả `order_item` theo `sourcePostId` |
| Video cũ dần tụt hạng | Có | `hot-v1.spec.ts` (v3 cũ hơn v1 cùng tín hiệu) |
| Tương tác từ tài khoản mới trọng số thấp | Có | `hot-v1.spec.ts` › `accountWeight`, 20 tim tài khoản 1 ngày thua 10 tim tài khoản cũ |
| Cùng lượt xem thì so tỉ lệ | Một phần | Công thức và test có; chờ sự kiện `content.post.viewed` (Phong) |
| Bấm vào khách sạn được tính | Chưa | Chờ sự kiện bấm khách sạn (Phong); thêm trọng số khi có |
| Không thấy lại video vừa xem | Chưa (phần Phong) | Tạm hạ điểm bài đã gợi ý; "đã xem thật" cần sự kiện lượt xem |

## Kết quả kiểm tra
- `pnpm turbo run lint typecheck test --filter=@tripflix/core-api`: 13/13 task thành công; lint 0 lỗi; typecheck sạch; **2488 test pass, 4 skip** (108 file pass, 2 skip).
- `vitest --config vitest.int.config.ts src/modules/discovery` (Postgres thật qua Testcontainers): **17/17 pass**.
- Đã merge `origin/develop` mới nhất trước khi push (gồm TF25 của Thành), không xung đột, `pnpm contracts:build` không sinh khác biệt.

## Cách kiểm lại
1. `pnpm install && pnpm turbo run lint typecheck test --filter=@tripflix/core-api`
2. Có Docker: `cd apps/core-api && npx vitest run --config vitest.int.config.ts src/modules/discovery`
3. `pnpm contracts:build` rồi `git diff contracts/`: không có thay đổi.

## Ảnh / video
- Không đổi giao diện.

## Ảnh hưởng tới phần của người khác
- Không sửa code của người khác. `/api/recommendations/reels` cần `FeedFacade.getByIds` từ `content/feed` (Phong), đã thống nhất; nối vào `discovery.module.ts` ở PR sau khi Phong export.
- `trending`/`for_you` của `/api/recommendations/posts` (tab Bài viết trên web) đổi sang `hot@v1`: thứ tự bài có thể khác trước.
