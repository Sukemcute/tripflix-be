# TF25 — Dọn bài viết cũ lỡ kèm video

- Jira: [SCRUM-29](https://tripflix.atlassian.net/browse/SCRUM-29) · Nhánh: `thanh/TF25-don-bai-viet-gan-video` · Người làm: Lê Quang Thành (dùng AI: có) · Ngày: 2026-11-16

## Bối cảnh
- Bài viết (vlog) tạo trước khi tách Reels và Bài viết còn kèm video. Video không lên Reels, web không hiện, bản nháp loại này không lưu được.
- Kiểm ngày 16/11: staging và local đều chỉ có 4 bài như vậy, cả 4 là bài mẫu trong seed (Đà Nẵng 3N2Đ, Vinpearl Phú Quốc, Nha Trang 4N3Đ, Fansipan), đều có lộ trình.
- Anh Thành chọn gỡ video, giữ là Bài viết (không chuyển sang Reels), để tab Bài viết và nhóm "Lộ trình" trong tìm kiếm vẫn còn bài mẫu.

## Đã làm
- **Migration dữ liệu `20261116034606_vlog_video_cleanup`** (content):
  - Gỡ id video khỏi `media_ids` của bài viết chưa xoá, giữ ảnh và id không tra được theo thứ tự cũ.
  - Ảnh bìa là video thì bỏ.
  - `media_ids` lỡ lưu dạng chuỗi được coi như mảng một phần tử.
  - Cập nhật `updated_at`, tìm kiếm tự dựng lại chỉ mục sau tối đa 10 phút.
- **Seed:** 4 bài viết mẫu bỏ video để DB mới không sinh lại lỗi. Spec seed kiểm Reels có đúng một video, bài viết không kèm video.

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| Bài viết không còn kèm video | Có | `vlog-video-cleanup.int.spec.ts` (Postgres thật): chỉ video, lẫn ảnh, nháp nhiều video, `media_ids` dạng chuỗi |
| Không đụng Reels, bài chỉ có ảnh, bài đã xoá | Có | cùng file |
| Chạy lại không đổi gì | Có | cùng file › chạy lại lần nữa |
| DB mới không sinh lại dữ liệu sai | Có | `seed-content.spec.ts` |
| Đúng 4 bài trên local | Có | Chạy thử trong transaction rồi rollback trên DB local: `UPDATE 4` |

## Kết quả kiểm tra
- `pnpm turbo run lint typecheck test --filter=@tripflix/core-api`: 13/13 task pass, 2443 test pass (4 skipped có sẵn), lint 0 lỗi.
- `pnpm --filter @tripflix/core-api test:int src/modules/content/db/vlog-video-cleanup`: 2/2 pass.

## Cách kiểm lại
1. `pnpm --filter @tripflix/core-api build && pnpm --filter @tripflix/core-api db:migrate`.
2. `GET /api/v1/posts?post_type=vlog`: 4 bài mẫu có `mediaIds: []`, vẫn có lộ trình.

## Ảnh / video
- Không đính kèm (theo yêu cầu).

## Ảnh hưởng tới phần của người khác
- `content/db` (anh Phong, Thành, Trang): thêm một migration dữ liệu, không đổi schema.
- `posts-seed.json`: anh Phong (TF22, video seed) và Thắng (TF29, chặng đi lại) từng sửa. Chỉ bỏ `mediaIds` của 4 bài viết, giữ nguyên lộ trình. 4 video mẫu trong `mediaAssets` vẫn còn, không bài nào trỏ tới.
