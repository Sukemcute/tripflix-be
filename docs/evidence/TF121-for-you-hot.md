# TF121 — Feed: tab Dành cho bạn của feed trả thứ tự Hot, bỏ chấm điểm mỗi lần đọc

- Jira: [SCRUM-193](https://tripflix.atlassian.net/browse/SCRUM-193) · Nhánh: `phong/TF121-for-you-hot` · Người làm: Phong (dùng AI: có) · Ngày: 2026-11-27

## Đã làm

- `GET /api/v1/feed?tab=for_you` (không `saved`, không `author_id`) đọc đúng đường của tab Hot (`listHotPosts`, điểm `trend_scores` job chấm sẵn mỗi 5 phút). Trang đầu dùng chung cache với tab hot (`feed:first-page:v3:hot:<seed>:<limit>`).
  - Vì sao: TF120 đo được `for_you` chỉ chịu khoảng 10 req/s vì `listForYouPosts` chấm điểm cả 42.821 bài ở mỗi lần đọc; tab hot chịu 50 req/s với p95 42 ms. Người đăng nhập đã đọc Dành cho bạn từ discovery (`/api/recommendations/reels?mode=mixed`, FE commit `7295cd9e`), nên feed `for_you` chỉ còn cho khách, app bản cũ và màn trợ lý.
- Cursor `for_you` cũ (có `rank`, hoặc không có điểm Hot) không lỗi: trả lại trang Hot đầu với seed trong cursor (không có thì seed 0), không ghi cache.
- Luật cursor (`api/dto.ts`): tab hot vẫn bắt buộc có điểm Hot; Reels đã lưu và trang tác giả của for_you (mới nhất trước) không nhận cursor có điểm Hot.
- Xoá `listForYouPosts`, `counterScore`, các hằng `FOR_YOU_*` và `domain/hot-score.ts` (chỉ cách chấm cũ dùng), cùng test của chúng. Phong đồng ý xoá.
- Mô tả OpenAPI của `GET /api/v1/feed` sửa theo thứ tự mới (câu cũ "for_you xếp mới nhất trước" đã sai từ trước), sinh lại `contracts/openapi/core-api.json`. Không đổi hình dạng API.
- Hệ quả đã chấp nhận: với khách, phần đầu hai tab giống nhau (seed chỉ xáo bài bằng điểm); for_you chỉ còn bài video trong 30 ngày.

## Đối chiếu "Xong khi"

| Tiêu chí (chép từ Jira)                                                                                   | Đạt  | Bằng chứng                                                                                                                                                                                                                                        |
| --------------------------------------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tab=for_you` (không saved, không author_id) trả cùng thứ tự với `tab=hot` cùng seed; có test unit và e2e | Đạt  | Unit `feed.use-cases.spec.ts` "for_you trả đúng thứ tự Hot và dùng chung cache trang đầu"; e2e `feed.e2e.spec.ts` "TF121: tab for_you trả cùng thứ tự với tab hot"; int `feed.int.spec.ts` "seed nào cũng ra đúng thứ tự tab hot" (Postgres thật) |
| Cursor `for_you` cũ (có `rank`) không gây lỗi 500                                                         | Đạt  | Unit "cursor for_you cũ … thì trả lại trang Hot đầu, giữ seed"; e2e "TF121: cursor for_you cũ … trả lại trang Hot đầu, không lỗi" (200)                                                                                                           |
| Mô tả OpenAPI của tab cập nhật, `pnpm contracts:build` chạy lại                                           | Đạt  | `contracts/openapi/core-api.json`: chỉ đổi `summary` của `GET /api/v1/feed`                                                                                                                                                                       |
| `pnpm turbo run lint typecheck test --affected` đạt                                                       | Đạt  | Mục "Kết quả kiểm tra"                                                                                                                                                                                                                            |
| Đo lại bằng bộ k6 TF120 trên staging, ghi số trước/sau; staging trả về như cũ                             | Chưa | Chờ merge và Phong cho phép đo trên staging                                                                                                                                                                                                       |

## Kết quả kiểm tra

- `pnpm turbo run lint typecheck test --affected`: 49/49 task đạt.
- `apps/core-api` `vitest run`: 205 file đạt, 2 file bỏ qua sẵn có (không thuộc feed); 3.233 test đạt, 4 bỏ qua sẵn có.
- Test int (Postgres thật, Testcontainers): `src/modules/content/feed` 26/26 đạt; `content/social/infra/held-content.int.spec.ts` (cũng dùng `DrizzleFeedStore`) 5/5 đạt.
- `pnpm contracts:build`: đạt.

## Cách kiểm lại

1. `pnpm install && pnpm turbo run lint typecheck test --affected`
2. `cd apps/core-api && pnpm test:int -- src/modules/content/feed` (cần Docker).
3. Trên staging sau khi deploy: gọi `GET /api/v1/feed?tab=for_you&limit=10` và `tab=hot` vài lần (seed ngẫu nhiên), hai tab có cùng nhóm bài đầu; sang trang bằng `nextCursor` của for_you không lỗi.

## Đo lại trên staging

- Chưa đo. Sẽ chạy `tools/bench/feed-load` (`sh run.sh scale c1`, feed trộn, khách) và so với bảng TF120 (`docs/evidence/TF120-do-tai-feed.md`, phép 2).

## Ảnh / video

- Không đổi giao diện.

## Ảnh hưởng tới phần của người khác

- Không sửa code của ai, chỉ module `content/feed` (Phong).
- Có về hành vi:
  - Trang (`apps/mobile`) và Thành (`apps/web`): màn trợ lý dò ảnh bìa qua `feedApi.list` (tab `for_you`), sau thay đổi chỉ dò trong bài Hot 30 ngày. Đề xuất đổi sang `feedApi.listByIds`; chưa báo, chờ Phong duyệt tin.
  - Duy: không ảnh hưởng. Discovery đọc `FeedFacade.listTopHot` (gọi `FeedUseCases.getHotIds`), task này không đổi hàm đó.
