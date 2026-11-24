# TFxx — Ảnh bìa video trong kết quả tìm kiếm

- Nhánh: `phong/TFxx-thumbnail-tim-video` · Người làm: Phong (dùng AI: có) · Ngày: 2026-11-20

## Đã làm
- Lỗi: trang tìm kiếm (web tab "Tất cả", khung tìm của app) hiện ô trống có icon camera cho mọi video và lộ trình. API tìm (`/api/search/...`) trả `thumbnail: null` cho mọi bài vì `postToObject` không gán `thumbnail`; chỉ khách sạn có ảnh.
- `search/infra/explore-post-posters.ts`: `withVideoPosters` gắn `posterUrl` cho bài video, là poster 360 của video đầu tiên phát được (giống thẻ feed). Bài không phải video, hoặc video chưa sẵn sàng, nhận null.
- `discovery.module.ts`: `exploreCatalog.listPosts` gọi `MediaFacade.getPlayback` một lần cho mỗi trang 100 bài (chỉ khi trang có video), inject thêm `MediaFacade` (đã export từ `content`).
- `ExplorePost` thêm `posterUrl`; `postToObject` gán `thumbnail: p.posterUrl ?? null`.
- Không đổi API, không migration: chỉ mục lưu cả object dạng jsonb và được dựng lại toàn bộ theo chu kỳ, nên ảnh có sau lần dựng đầu tiên sau deploy.
- Không làm: ảnh bìa cho bài viết ảnh (không phải video), danh sách video theo người dùng trong khung tìm của app (FE, chưa từng có ảnh).

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| Kết quả tìm có ảnh bìa cho video | Đạt (unit) | `explore.use-cases.spec.ts`: bài video có `posterUrl` thì `thumbnail` đúng URL, không có thì null |
| Chọn đúng poster, không đọc media thừa | Đạt (unit) | `explore-post-posters.spec.ts`: lấy video đầu tiên phát được, bỏ video chưa sẵn sàng và bài ảnh; trang không có video thì không gọi media |
| Hiện ảnh trên staging | Chưa | Chờ merge, deploy và chỉ mục dựng lại |

## Kết quả kiểm tra
- `pnpm turbo run lint typecheck test --filter=@tripflix/core-api...`: 43/43 task, core-api 3120 test đạt (4 bỏ qua), lint 0 lỗi.

## Cách kiểm lại
1. Sau deploy, chờ job dựng lại chỉ mục tìm kiếm chạy xong một lượt.
2. Mở `https://tripflix.io.vn`, tìm "tripflix": mục Video và Lộ trình có ảnh poster.
3. Hoặc gọi API tìm bài, các item `kind: "video"` có `thumbnail` dạng `https://media.tripflix.io.vn/.../poster_360.jpg`.

## Ảnh / video
- Chụp trang tìm web trước khi sửa (ô trống icon camera); ảnh sau khi sửa thêm vào PR sau khi lên staging.

## Ảnh hưởng tới phần của người khác
- Có: `discovery` (Duy) — `discovery.module.ts`, `search/application/ports.ts`, `explore.use-cases.ts` (+spec), file mới `search/infra/explore-post-posters.ts`. Chỉ thêm field `posterUrl` và gán `thumbnail`, không đổi API, sự kiện, schema. Dùng `MediaFacade.getPlayback` (Phong) qua `content/index.ts`. Cần Duy duyệt PR.
