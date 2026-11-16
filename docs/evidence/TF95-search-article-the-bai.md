# TF95 — `POST /search/posts`: `postType: article` và thông tin thẻ bài

- Jira: chưa tạo · Nhánh: `duy/TF95-search-article-the-bai` · Người làm: Duy (dùng AI: có) · Ngày: 2026-11-16

## Đã làm
- Thêm `postType: article` = `plan` + `post`, bỏ **mọi** video kể cả video kèm lộ trình. Vùng Lộ trình có cả video kèm lộ trình, nên `article` lọc thêm `kind !== 'video'` ở kết quả chính; kết quả thay thế vốn lọc theo loại bài. Lọc ở server nên `total`, `nextCursor`, số bài mỗi trang đều đúng (web hết hụt trang khi tự bỏ video).
- Thêm vào mọi item kết quả (`/search` và `/search/posts`): `likes`, `comments`, `createdAt`, `author { id, name, avatarUrl }`. Mục không phải bài: `null`. `avatarUrl` luôn `null` (hệ thống chưa có dữ liệu, giống feed).
- Chỉ mục lưu thêm `authorId`, `createdAt` trong `doc jsonb`: không cần migration; sau deploy có dữ liệu từ lượt dựng lại kế tiếp (≤10 phút).
- Tên tác giả: discovery gọi `AccessFacade.getDisplayNames` một lần mỗi trang (quan hệ mới discovery → access, chỉ dùng hàm có sẵn). `pnpm contracts:build` chỉ thêm field/giá trị.

## Đối chiếu "Xong khi"
| Tiêu chí (từ yêu cầu 16/11) | Đạt | Bằng chứng |
|---|---|---|
| Có `postType` gồm plan + post, không đổi giá trị cũ | Có | `explore.use-cases.spec.ts` › "TF95: article = lộ trình + bài viết…" |
| Video kèm lộ trình không lọt vào `article` (kết quả chính và fallback) | Có | Cùng test: `plan` có V1, `article` không; fallback câu "lịch trình đà nẵng mùa thu": `all` có V1, `article` chỉ P1. Bỏ bộ lọc thì test fail |
| Phân trang đủ `limit` | Có | Cùng test: limit 2 → 2 + 2 bài, `total: 4`, trang cuối `nextCursor: null` |
| Kết quả có số tim, bình luận, ngày đăng, tên tác giả; avatar `null` | Có | Test "TF95: item bài có số tim…" (khách sạn để `null`, tác giả không tìm thấy → `name: null`) |
| Cập nhật contracts | Có | `contracts/openapi/core-api.json` |

## Kết quả kiểm tra
- `vitest run explore.use-cases.spec.ts`: 12/12 pass.
- `pnpm turbo run lint typecheck test --filter=@tripflix/core-api`: lint 0 lỗi, typecheck pass; test 2468 pass, 1 fail `content/moderation/infra/ai-moderation.client.spec.ts` › "timeout fallback không retry" (timeout 40ms, chập chờn khi chạy song song; chạy riêng 12/12 pass, không liên quan thay đổi).
- `pnpm turbo run lint typecheck test --affected`: `@tripflix/video-worker#test` fail 1 khi chạy chung; chạy riêng 49/49 pass (không đụng video-worker).

## Cách kiểm lại
1. `cd apps/core-api && npx vitest run src/modules/discovery/search/application/explore.use-cases.spec.ts`
2. Stack local: `POST /api/search/posts` với `{"q":"đà nẵng","postType":"article","limit":2}` → không có item `kind: "video"`, mỗi item có `likes`, `comments`, `createdAt`, `author`.

## Ảnh / video
- Không đổi giao diện.

## Ảnh hưởng tới phần của người khác
- `access` (Dũng): chỉ gọi `AccessFacade.getDisplayNames` có sẵn, không sửa code access. `DiscoveryModule` import thêm `AccessModule`.
- Web (Thành): field mới chỉ thêm, không đổi field cũ. Search không có `viewerContext` (đã thích/đã lưu), web vẫn cần lấy nếu thẻ hiện trạng thái đó.
