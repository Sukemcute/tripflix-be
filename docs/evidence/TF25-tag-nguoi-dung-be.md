# TF25 — Tag người dùng trong bình luận (BE)

- Phạm vi: brief giao việc và xác nhận của người dùng trong chat; không có link Notion được cung cấp.
- Nhánh: `thanh/TF25-tag-nguoi-dung`, tách từ `origin/develop` tại `941732e` sau khi orchestrator fetch.
- Người làm: Thành (dùng AI: có). Ngày: 2026-11-19.

## Đã làm

- Thêm `comments.mentions jsonb NOT NULL DEFAULT '[]'`. Migration được sinh bằng drizzle-kit với config content của repo, chỉ thêm cột, có `SET LOCAL lock_timeout = '5s'`, không backfill. Chưa áp dụng migration hoặc kết nối DB local.
- Domain Comment kiểm tối đa 10 tag, UUID hợp lệ và không trùng người, offset/length nguyên theo UTF-16, khoảng nằm trong body, bắt đầu bằng `@`, có tên, không chồng nhau hoặc cắt đôi surrogate pair. Chuẩn hóa UUID về chữ thường và sắp tag theo offset.
- Span tính trên body của request, bao gồm `@`. Khi trim body, BE trừ phần khoảng trắng đầu khỏi offset và kiểm lại span trên body đã trim; response trả body/offset đã chuẩn hóa. BE không tự suy tag từ chữ `@`.
- Add/edit xác minh tất cả user được tag qua UserDirectoryPort, trước transaction ghi. Directory lỗi hoặc user không tồn tại thì không ghi. Không gọi dịch vụ ngoài trong transaction.
- Edit thiếu `mentions` giữ và kiểm lại tag cũ trên body mới, kể cả user tồn tại. `mentions: []` xóa tag. Body/mentions thay đổi trong lúc chuẩn bị hoặc chờ khóa thì trả conflict, tránh ghi đè tag đã được sửa đồng thời.
- API tạo/sửa nhận field tùy chọn, giữ các field/endpoint cũ, kể cả `parent_comment_id: null` khi tạo bình luận gốc; response tạo/sửa/list/focus/hàng chờ creator có `mentions`, mặc định `[]`. Bình luận hidden/removed được che tag cùng body.
- Payload xuất bản của social thêm `mentionedUserIds` khi có tag: đăng ngay và lần đầu công khai sau creator approve/platform restore. Shared context loader đọc metadata tag đã lưu nếu moderation truyền projection thiếu mentions; không sửa source moderation. Không gửi notification mới khi chỉ edit.
- Sinh lại OpenAPI từ DTO nguồn: chỉ thêm schema CommentMentionDto và các field mentions. Không sửa tay contract artifact; không sửa libs/contracts hoặc notification-service.

## Đối chiếu tiêu chí trong brief

| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| Review #271/#273 trước khi code TF25 | Có, review mã local; GitHub chưa truy cập được | `scratchpad/results/review-271-273.md`, có giới hạn nguồn được ghi rõ |
| Nhánh từ develop vừa fetch, không đổi develop local | Có | Base `941732e`; develop local vẫn `2f93dbb` |
| JSONB lưu userId/offset/length, không username | Có | Schema comments và migration `20261119023209_comment_mentions` |
| Domain validation và kiểm user | Có | `comment-mention.spec.ts`, `comment-mentions.e2e.spec.ts` |
| Edit giữ/kiểm lại/bỏ tag theo quy ước | Có | Domain + E2E kiểm omitted, `[]`, thay tag, user đã mất, conflict |
| API chỉ thêm field, sinh lại OpenAPI | Có | `contracts/openapi/core-api.json`, E2E kiểm schema request/response |
| Unit domain và E2E theo quy ước repo | Có | 23 domain, 23 HTTP E2E; thêm 1 regression payload cho delayed publication |
| Lint/typecheck/test core-api | Có | Kết quả thực tế bên dưới |
| Không sửa code của Dũng/Trang ngoài phạm vi | Có | Không sửa libs, notification-service, access, moderation, feed, discovery |

## Kết quả kiểm tra

Máy có Node v22.17.1, người dùng đã cho phép bỏ cảnh báo engines. Sandbox không truy cập được pnpm tại Roaming nên dùng binary đã cài trong node_modules, không cài/tải thêm gói. Các lệnh bên dưới là phần thực thi tương ứng của các script repo.

| Kiểm tra | Lệnh thực tế | Kết quả |
|---|---|---|
| Build lại dependency contracts hiện có, không sửa source | `node node_modules/typescript/bin/tsc -p libs/contracts/tsconfig.build.json` | Pass; xử lý dist cũ thiếu export mới của develop |
| Lint core-api (cwd apps/core-api) | `node node_modules/oxlint/bin/oxlint --type-aware src` | Exit 0; 0 error, 123 warning; không có diagnostic tại các file mention mới/helper/edit |
| Typecheck (cwd repo) | `node node_modules/typescript/bin/tsc -p apps/core-api/tsconfig.json --noEmit` | Pass |
| Toàn bộ unit/E2E core-api, không chạy int Docker (cwd apps/core-api) | `node node_modules/vitest/vitest.mjs run --passWithNoTests --maxWorkers=2` | 166 file pass, 2 file skip; 2.919 test pass, 4 skip; lượt cuối 268,45 giây |
| Build core-api (cwd apps/core-api) | `node node_modules/@nestjs/cli/bin/nest.js build` | Pass |
| Sinh event artifacts hiện có (cwd repo) | `node libs/contracts/dist/export-schemas.js` | Pass; không đổi artifact event nào |
| Sinh OpenAPI (cwd apps/core-api) | `node dist/cli/export-openapi.js` | Pass; chỉ thêm 58 dòng liên quan mentions |
| Sinh migration (cwd apps/core-api) | `node node_modules/drizzle-kit/bin.cjs generate --config src/modules/content/db/drizzle.config.ts --name comment_mentions` | Pass; 1 cột, không UPDATE/backfill |
| Ranh giới module (cwd repo) | `node tools/check-boundaries.mjs` | Pass |
| Whitespace | `git diff --check` | Pass |

Lượt test chọn lọc đầu tiên có 3 assertion cũ chưa mong đợi field mentions mới; đã thêm expectation chính xác `mentions: []`, không bỏ qua hoặc nới lỏng assertion. Lượt typecheck đầu tiên gặp dist contracts cũ và lỗi type fixture mới; đã build lại dependency và sửa fixture trong phạm vi task trước lượt kiểm tra đạt cuối cùng.

Không chạy `db:migrate`, không chạy test integration có DB hoặc test trên DB local; HTTP E2E dùng controller/guard/validation/use case thật, repository/directory bộ nhớ, transaction plugin no-op theo quy ước repo. Chưa xác minh migration trên PostgreSQL thực tế.

## API để FE dùng

`POST /api/v1/posts/:postId/comments`; field phản hồi cũ `parent_comment_id` được giữ nguyên nếu tạo reply. `PATCH /api/v1/comments/:commentId` dùng cùng body/mentions.

```json
{
  "body": "Chào @Nguyễn An",
  "mentions": [
    { "userId": "018d9f00-0000-7000-8000-000000000002", "offset": 5, "length": 10 }
  ]
}
```

Response giữ các field cũ, ví dụ phần chính:

```json
{
  "id": "018d9f30-0000-7000-8000-000000000001",
  "postId": "018d9f20-0000-7000-8000-000000000001",
  "authorId": "018d9f00-0000-7000-8000-000000000001",
  "body": "Chào @Nguyễn An",
  "mentions": [
    { "userId": "018d9f00-0000-7000-8000-000000000002", "offset": 5, "length": 10 }
  ],
  "status": "visible",
  "isEdited": false,
  "moderationState": null,
  "likeCount": 0,
  "isLiked": false
}
```

List/focus/hàng chờ creator trả mentions trên mỗi item. Bản ghi không có tag trả `[]`. Lỗi payload/span/user không tồn tại: 400; sửa của người khác: 403; bình luận thay đổi đồng thời: 409. Directory bị lỗi: thất bại, không ghi tag chưa xác minh.

## Cách kiểm lại

1. Ở môi trường cho phép chạy pnpm: `pnpm --filter @tripflix/core-api lint`, `pnpm --filter @tripflix/core-api typecheck`, `pnpm --filter @tripflix/core-api test -- --maxWorkers=2`.
2. Kiểm riêng logic bằng 2 file `comment-mention.spec.ts` / `comment-mentions.e2e.spec.ts` và helper `comment-publication.spec.ts` trong cấu hình Vitest mặc định. E2E kiểm create/read/edit/reply, Unicode/emoji, malformed tag, unknown user/directory failure, auth, conflict, các nhánh held và che metadata.
3. Sinh artifact theo script repo `pnpm contracts:build`; đối chiếu OpenAPI. Không áp dụng migration trong phiên này.
4. Khi triển khai có chủ DB thực hiện: áp migration content mới trước app đọc cột mentions, rồi kiểm trên PostgreSQL ở môi trường được phép. Không cần backfill tag cũ.

## Ảnh / video

Không có: đây là phần BE, brief yêu cầu không ảnh chụp.

## Ảnh hưởng tới phần của người khác

- Schema content/comments đồng sở hữu Phong/Thành/Trang và DI ContentModule: thay đổi đúng phạm vi brief đã giao; chỉ thêm cột, giữ hành vi đếm và các field cũ.
- Shared helper social được creator approve/platform release dùng: thêm metadata tag; không sửa source moderation và không đổi quyết định kiểm duyệt. Bốn phát hiện review được để riêng, không sửa trong task này.
- Dũng cần bổ sung `mentionedUserIds?: string[]` (UUID, unique) vào schema `content.comment.created` ở libs/contracts và sinh event schema. `authorDisplayName` đã có sẵn. Consumer schema hiện chưa giữ field mention mới.
- Dũng cần triển khai inbox `comment.mentioned`: bỏ self mention, chống trùng theo comment/người nhận và phối hợp thông báo reply/post-owner hiện có; kiểm quyền xem bài, không lộ nội dung bài private cho người ngoài. Chỉ nhận created lúc bình luận được công khai trong phạm vi quyền xem bài, không gửi khi held hoặc chỉ edit.
- Producer social đã giữ metadata qua lần đầu nhả held; notification end-to-end vẫn phụ thuộc phần Dũng. Chưa test Socket.IO/inbox mention hoặc sửa notification-service.
- Không push, PR, merge hay cập nhật GitHub/Notion theo yêu cầu phiên này.
