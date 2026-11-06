# TF22 — Tab "Đang hot" cho GET /v1/feed

- Nhánh: `phong/TF22-feed-hot-tab` · Người làm: Phong (dùng AI: có) · Ngày: 2026-11-06

App có thanh 3 tab ở Reels. Tab "Đang hot" cần API xếp bài theo độ tương tác; trước đó `tab` chỉ nhận `for_you`.

## Đã làm

- Thêm giá trị `hot` cho tham số `tab` của `GET /api/v1/feed`. Chỉ thêm, `for_you` và mặc định giữ nguyên.
- Điểm hot = thích × 1 + bình luận × 2 + lưu × 3 + chia sẻ × 4 (`domain/hot-score.ts`), bằng điểm thì bài mới nhất trước.
- Cursor của tab hot chứa cả điểm, để sang trang không lặp và không rớt bài khi nhiều bài trùng điểm.
- Sinh lại `contracts/openapi/core-api.json`.

## Chưa làm

- Chưa có bán rã theo thời gian, vì bộ đếm không lưu thời điểm tương tác. Bài cũ nhiều tương tác sẽ giữ vị trí cao.
- Tab "Đang theo dõi" trên app chưa có API, vì chưa có bảng `follows`.

## Đối chiếu tiêu chí

Task chưa có tiêu chí "Xong khi" trên Notion; bảng dưới là tiêu chí tự đặt khi làm.

| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| Xếp đúng trọng số, bằng điểm thì mới nhất trước | Có | `feed.int.spec.ts`: "xếp theo trọng số thích 1, bình luận 2, lưu 3, chia sẻ 4" |
| Sang trang không lặp, không rớt bài khi trùng điểm và thời điểm | Có | `feed.int.spec.ts`: "sang trang không lặp, không rớt bài" |
| Vẫn lọc bài không phát được | Có | `feed.int.spec.ts`: "vẫn lọc bài không phát được" |
| Cursor giữ điểm, kể cả điểm 0 | Có | `feed-cursor.spec.ts` |
| API và cursor hoạt động qua HTTP | Có | `feed.e2e.spec.ts`: "tab hot xếp theo điểm và sang trang bằng cursor có điểm" |

## Kết quả kiểm tra

Chạy trên nhánh trước khi merge `develop`:

- `pnpm turbo run lint typecheck test --affected`: 49/49 tác vụ đạt; `core-api` 410 test đạt, 1 bỏ qua.
- `vitest run src/modules/content/feed`: 22/22 đạt.
- `vitest run --config vitest.int.config.ts .../feed.int.spec.ts` (Postgres thật qua Testcontainers): 8/8 đạt.
- Gọi `GET /api/v1/feed?tab=hot&limit=3` trên API local: 200, ba bài đầu có điểm 210, 193, 182, có `nextCursor`.
- Production hiện trả 400 với `tab=hot`; sẽ chạy được sau khi bản này được deploy.

## Cách kiểm lại

1. `cd apps/core-api && pnpm exec vitest run --config vitest.int.config.ts src/modules/content/feed/application/feed.int.spec.ts` (cần Docker).
2. Chạy API rồi gọi `GET /api/v1/feed?tab=hot&limit=3`, tính điểm theo công thức trên và xem thứ tự giảm dần.

## Ảnh / video

- Không đổi giao diện ở repo này.

## Ảnh hưởng tới phần của người khác

- Không. Chỉ sửa `content/feed` do Phong phụ trách và file sinh `contracts/openapi/core-api.json`.
- FE: `tripflix-fe` dùng giá trị `hot` qua client sinh tự động, ở PR riêng.
