# TF87 — Kiểm duyệt bài đăng hiện mã user thay vì tên tác giả

- Jira: [SCRUM-114](https://tripflix.atlassian.net/browse/SCRUM-114) · Nhánh: `trang/TF87-admin-hien-ten-tac-gia` · Người làm: Trang (dùng AI: có) · Ngày: 2026-11-13

## Đã làm
- `list-admin-posts.use-case.ts`: tra tên tác giả qua `UserDirectoryPort` (gọi `AccessFacade.getDisplayNames`), mỗi tác giả chỉ tra một lần cho cả trang. Trước đây `display_name` bị ghi cứng thành `User <8 ký tự đầu của id>`.
- `get-admin-post-detail.use-case.ts`: chi tiết bài trên admin cũng hiện tên thật.
- Không tra được tên (user đã xoá, module access lỗi) thì giữ tên dự phòng `User xxxxxxxx`, trang vẫn hiện bình thường. Tên dự phòng nằm trong hàm `buildFallbackDisplayName`.
- `content.module.ts`: inject `USER_DIRECTORY_PORT` cho 2 use case trên. Tham số mới là tùy chọn, các chỗ khởi tạo cũ vẫn chạy.
- Không đổi hợp đồng API (`author.display_name` giữ nguyên), FE không phải sửa.

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| Danh sách và chi tiết bài trên màn kiểm duyệt hiện đúng tên tác giả | ✅ | Test `hiện tên thật của tác giả, tra tên một lần cho mỗi tác giả`, `hiện tên thật của tác giả trong chi tiết bài` |
| Tra tên lỗi thì vẫn hiện danh sách với tên dự phòng | ✅ | Test `vẫn trả danh sách với tên dự phòng khi tra tên bị lỗi`, `dùng tên dự phòng khi không tìm thấy tên tác giả` |
| Có unit test, lệnh kiểm tra của repo pass | ✅ | Mục "Kết quả kiểm tra" |

## Kết quả kiểm tra
- `pnpm turbo run lint typecheck test --affected`: 49/49 task thành công.
  - core-api: 102 file test pass (1 skip có sẵn), 2339 test pass, 1 skip có sẵn. Lint 0 lỗi.
- `social-use-cases.spec.ts`: 45/45 pass, trong đó có 4 test mới.

## Cách kiểm lại
1. `pnpm turbo run lint typecheck test --affected`
2. Chạy stack local, đăng nhập admin, mở màn kiểm duyệt bài đăng: cột Tác giả hiện tên hiển thị thay vì `User xxxxxxxx`.

## Ảnh / video
- Ảnh trước khi sửa (cột Tác giả hiện `User 7bcb56b4`) đính kèm trong PR.

## Ảnh hưởng tới phần của người khác
- Có: `content/social` (chủ: Thành, backup: Trang) và `content.module.ts`. Đã báo Thành. Không đổi API, sự kiện hay schema.
