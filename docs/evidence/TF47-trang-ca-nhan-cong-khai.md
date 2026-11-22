# TF47 — Trang cá nhân công khai (phần BE)

- Notion: (chưa có) · Nhánh: `dung/TF47-trang-ca-nhan-cong-khai` · Người làm: Dũng (dùng AI: có) · Ngày: 2026-11-16

## Đã làm
- Thêm `GET /v1/users/:userId/profile` (không cần đăng nhập): `{ id, displayName, followerCount, followingCount, likeCount }`
  cho trang cá nhân công khai trên app và web.
- `likeCount` là tổng `reaction_total` trên các bài `published` + `public` chưa xoá, cùng điều kiện với
  `GET /v1/posts?author_id=`. Dùng index `idx_posts_author_status`; số follow dùng PK và `idx_follows_author_follower`.
- Người dùng không tồn tại thì trả 404, không đếm gì.
- Chỉ thêm endpoint, không đổi API cũ; `contracts/openapi/core-api.json` chỉ thêm 68 dòng.

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| Có API trả số follow, số đang theo dõi, tổng like của một người | Có | `follows-profile.spec.ts` (2 test) |
| Đếm follow đúng hai chiều | Có (chờ CI) | `follow.repository.int.spec.ts` thêm assert `countFor`, cần Docker nên chạy ở CI |
| Không đổi API cũ | Có | diff `contracts/` chỉ thêm |

## Kết quả kiểm tra
- `pnpm turbo run lint typecheck test --affected`: 49/49 task pass; `core-api` 2580 test pass, 4 skip có sẵn;
  lint 0 lỗi.
- Integration test (`test:int`) không chạy được ở máy local vì Docker không bật.

## Cách kiểm lại
1. `pnpm --filter @tripflix/core-api exec vitest run src/modules/content/social/api/follows-profile.spec.ts`
2. Chạy stack, gọi `curl http://localhost:<port>/api/v1/users/<id>/profile`.

## Ảnh / video
- Xem evidence TF47 bên `tripflix-fe`.

## Ảnh hưởng tới phần của người khác
- Có: `content/social` (chủ Thành, backup Trang): `follows.controller.ts`, `follow.repository.ts`, `post.repository.ts`
  chỉ thêm hàm mới. Cần báo Thành trước khi merge.
