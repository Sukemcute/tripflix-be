# TF90 — Trạng thái held cho bài và bình luận, chặn tương tác với bài không được xem (BE-07a)

- Jira: [SCRUM-118](https://tripflix.atlassian.net/browse/SCRUM-118) · Nhánh: `trang/TF90-trang-thai-held` · Người làm: Trang (dùng AI: có) · Ngày: 2026-11-16

## Đã làm
- Thêm trạng thái `held` (luật nhanh giữ lại lúc đăng, chờ kiểm duyệt) cho bài và bình luận. TF91 mới bắt đầu ghi `held`; task này chỉ chuẩn bị trạng thái và chặn đường lộ ra ngoài.
  - `PostStatus` (domain và schema): thêm `held`. Cột `posts.status` không có CHECK nên không cần migration.
  - Bình luận: kiểu trạng thái thêm `held`; migration mới `20261116034812_comments_status_held` chỉ nới `ck_comments_status`.
- `Post.canBeViewedBy`: bài `held` chỉ tác giả và staff xem được, người khác như bài không tồn tại (404). Tác giả vẫn sửa được bài `held`.
- `track-share`: trước chỉ chặn bài `deleted`, nên bài `held`, `hidden`, `removed` hay nháp của người khác vẫn tăng `shareCount` và ghi `content.post.shared`. Giờ kiểm `canBeViewedBy` như thả tim, lưu bài, xem thống kê (các chỗ này đã kiểm từ PR #143).
- Hợp đồng API: thêm `held` vào enum `status` của bài (response) và bộ lọc admin. Chỉ thêm giá trị, đã chạy `pnpm contracts:build`.
- Không đổi hành vi đăng bài hay bình luận.

## Rà các chỗ đọc công khai
| Chỗ đọc | Cách lọc | `held` lọt? |
|---|---|---|
| Bảng tin bài viết, đồng bộ tìm kiếm (`findPublicPosts`, `findPostsForSync`) | `status = 'published'` | Không (integration test) |
| Reels (`DrizzleFeedStore`) | `status = 'published'` | Không (integration test) |
| Chi tiết bài, thống kê, tóm tắt AI, danh sách bình luận của bài | `canBeViewedBy` | Không (unit test entity) |
| Bookmark (`list-bookmarks`) | `status === 'published'` | Không |
| Danh sách người theo dõi nhận thông báo (`follows.controller`) | `status !== 'published'` thì không đủ điều kiện | Không |
| Danh sách, đếm, lấy mẫu, thống kê bình luận (`comment.repository`) | `status = 'visible'` | Không (integration test) |
| Trang "bài của tôi" (`/me/posts`) | tác giả xem bài của chính mình | Có, đúng ý: tác giả thấy bài đang giữ |

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| Bài/bình luận `held` không xuất hiện ở feed, chi tiết, trang cá nhân, Reels, bookmark, tóm tắt AI, mẫu bình luận | ✅ | `held-content.int.spec.ts` (Postgres thật) + `post.entity.spec.ts` › "bài đang giữ chờ kiểm duyệt chỉ tác giả hoặc staff xem được" + bảng rà ở trên |
| Thả tim, lưu, chia sẻ, xem thống kê bài `held`/`hidden`/`removed` bị chặn | ✅ | Thả tim/lưu/thống kê đã dùng `canBeViewedBy`; chia sẻ: `social-use-cases.spec.ts` › "không cho chia sẻ bài %s của người khác" (4 trạng thái, cả khách chưa đăng nhập). Bỏ đoạn chặn thì 4 test này fail |
| Lint, typecheck, test pass | ✅ | Mục "Kết quả kiểm tra" |

## Kết quả kiểm tra
- `pnpm turbo run lint typecheck test --affected`: 49/49 task thành công. core-api 2453 test pass, 4 skip có sẵn. Lint 0 lỗi; thêm 2 warning `unbound-method` cùng kiểu cả file `social-use-cases.spec.ts` đang dùng.
- `vitest run src/modules/content/social`: 194/194 pass.
- `vitest run --config vitest.int.config.ts src/modules/content/social/infra/held-content.int.spec.ts` (Postgres thật, chạy cả migration mới): 5/5 pass.
- `vitest run --config vitest.int.config.ts src/modules/content` (toàn bộ integration test của content): 10 file, 76/76 pass.

## Cách kiểm lại
1. `pnpm turbo run lint typecheck test --affected`
2. `cd apps/core-api && npx vitest run --config vitest.int.config.ts src/modules/content/social/infra/held-content.int.spec.ts` (cần Docker)

## Ảnh / video
- Không đổi giao diện.

## Ảnh hưởng tới phần của người khác
- Có: `content/social` (chủ Thành): `post.entity.ts`, `track-share.use-case.ts`, DTO, test; `content/db` (Phong, Thành, Trang): kiểu trạng thái và migration mới. Hướng làm đã được Thành duyệt (kế hoạch `docs/moderation/05-ke-hoach-p1-be07-be08.md` mục 8). Không đổi chữ ký hàm hay endpoint; API chỉ thêm giá trị enum.
- Integration test đọc `DrizzleFeedStore` của module feed (Phong) nhưng không sửa code feed.

## Kiểm lại sau khi tách nhánh
- Đã merge develop tại 52d1757: lint/typecheck/unit test đạt 49/49 task; core-api 2467 pass, 4 skip có sẵn.
- Integration content 76/76 là kết quả trước lần merge này. Docker hiện trả lỗi 500 nên chờ CI chạy lại integration cho HEAD mới.
- PR #190 của Thành có cùng kiểm tra canBeViewedBy ở track-share; cần phối hợp thứ tự merge và giữ test của cả hai PR.

## Sau review của Thành và merge #190/#192
- Merge develop tại 53c09ae: chỉ conflict comment track-share, giữ comment nhắc held, giữ toàn bộ test hai bên. Hai migration content được giữ nguyên.
- Test TF90 dùng outbox local với vi.fn() để bỏ cảnh báo unbound-method ở assertion outbox.
- Lint/typecheck/unit: 49/49 task đạt, core-api 2478 pass, 4 skip; riêng social 199/199 pass.
- Docker local vẫn lỗi 500; CI chạy integration lại cho bản này.
- TF91 cần bổ sung held vào PostStatus/ALLOWED_ACTIONS của moderation-post-detail.tsx và nhãn trạng thái ở moderation-workspace.tsx (kế hoạch mục 9 đã ghi).