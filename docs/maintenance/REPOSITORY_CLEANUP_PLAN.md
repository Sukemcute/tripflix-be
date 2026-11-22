# Kế hoạch dọn dẹp kho mã backend Tripflix

> Kế hoạch dưới đây ghi lại kết quả kiểm kê trước khi dọn. Ngày 22/11/2026, người dùng duyệt dọn minh chứng backend đến hết 15/11 và yêu cầu giữ nguyên `docs/social_content`. Xem [Báo cáo thực hiện](REPOSITORY_CLEANUP_REPORT.md) để đối chiếu các tệp đã xóa và kết quả kiểm tra.

## Mốc đối chiếu và kiểm kê

Nhánh `chore/repository-deep-cleanup` bắt đầu tại `7120e5869328978ea2f15bd417af4762d2950840` sau khi đồng bộ bằng chế độ fast-forward với `origin/develop`.

- `apps/core-api` là ứng dụng NestJS gồm các mô-đun truy cập, phân tích, thương mại, nội dung và khám phá. `apps/notification-service` và hai phiên bản worker xử lý video có Dockerfile riêng.
- `libs` gồm thư viện xác thực, cấu hình, hợp đồng dữ liệu, cơ sở dữ liệu, bus sự kiện, bảo đảm tính lũy đẳng, giám sát, outbox, lưu trữ và kiểm thử. `contracts` chứa OpenAPI và lược đồ sự kiện được sinh tự động để dùng chung giữa các dịch vụ. Migration Drizzle, snapshot được sinh và dữ liệu khởi tạo nằm cùng mô-đun dịch vụ.
- pnpm 10.32.1, danh mục phiên bản phụ thuộc chung và Turbo phục vụ build TypeScript. Worker Go có `go.mod` và `go.sum` riêng. Cấu hình Compose cục bộ, Compose máy chủ, Traefik, AWS và giám sát nằm trong `deploy`. CI cài phụ thuộc theo lockfile cố định, chạy lint, kiểm tra kiểu, kiểm thử, kiểm thử tích hợp qua Docker, build và sinh lại hợp đồng dữ liệu. Workflow phát hành build cả bốn ảnh dịch vụ.
- `tools` chứa công cụ kiểm tra ranh giới mô-đun, kiểm thử tải, đo hiệu năng bình luận và bảng tin, cùng các script xác minh thủ công. `docs` chứa kiến trúc, hồ sơ quyết định kiến trúc, bảo mật, giám sát, thiết kế nội dung xã hội và minh chứng theo đầu việc.
- Mốc ban đầu gồm **1.482 đường dẫn và 34.837.615 byte** được Git theo dõi. Tổng kích thước tệp trên đĩa bằng tổng kích thước blob Git theo từng đường dẫn tại commit đối chiếu. Kết quả `git count-objects -v` ghi nhận kho đối tượng Git cục bộ có 20.939 KiB đã đóng gói và 1.291 KiB đối tượng rời.

## Có thể xóa sau khi được phê duyệt

Chưa có tệp nào đủ căn cứ để đề xuất xóa. Mức giảm dự kiến là **0 byte** trước khi tính tài liệu bảo trì. Chưa đề xuất chỉnh sửa phụ thuộc, script, quy tắc bỏ qua hoặc cấu hình.

## Cần xem xét

| Đường dẫn | Byte | Hạng mục | Bằng chứng và lý do giữ lại để xem xét | Rủi ro có thể phát sinh | Độ tin cậy khi xóa |
| --- | ---: | --- | --- | --- | --- |
| `docs/social_content/ROADMAP_AND_PROPOSALS.md` | 18,154 | Lộ trình triển khai đã hoàn thành | Cả bảy giai đoạn đều được đánh dấu hoàn thành. Không tìm thấy tham chiếu trực tiếp đến đường dẫn trong ba cây mã nguồn được Git theo dõi. Tài liệu còn ghi lý do thiết kế huy hiệu xác thực, che thông tin cá nhân, kiểm duyệt thời gian thực và phân trang. Cần đối chiếu hồ sơ quyết định kiến trúc và hỏi người phụ trách trước khi đưa vào lưu trữ. | Mất lý do thiết kế quyền riêng tư và kiểm duyệt hoặc gãy liên kết từ hồ sơ TF02. | Thấp |
| `docs/social_content/API_ENDPOINTS.md` | 26,587 | Đặc tả API giai đoạn thiết kế | Lộ trình có liên kết đến tài liệu này. CI kiểm tra OpenAPI được sinh từ mã hiện hành. Đặc tả thiết kế vẫn có bảng đối chiếu yêu cầu sản phẩm và mã đầu việc với các endpoint. | Mất khả năng truy vết đầu việc hoặc mất tài liệu tham chiếu tích hợp. | Thấp |

## Phải giữ và kết quả rà soát phụ thuộc

- `deploy/compose.yaml` build worker TypeScript cho môi trường phát triển. Worker Go chạy trong Compose máy chủ. Cả hai ảnh đều có trong workflow phát hành và dọn registry. Giữ cả hai phiên bản và các bài kiểm thử dành cho từng môi trường.
- `apps/core-api/src/modules/commerce/db/seed/catalog.json` (17.259.327 byte), `osm-image-credits.json` (5.194.945 byte) và `review-photos.json` (2.902.537 byte) phục vụ khởi tạo dữ liệu, kiểm thử hoặc ghi công nguồn ảnh. Các bài kiểm thử tích hợp, công cụ sinh reel và đo hiệu năng tìm kiếm dùng catalog. `catalog-data.spec.ts` kiểm tra trực tiếp tệp ghi công. Danh mục ảnh cung cấp dữ liệu khởi tạo đánh giá và chứa thông tin ghi công.
- Giữ migration và snapshot Drizzle, đầu ra OpenAPI và lược đồ sự kiện, dữ liệu kiểm thử hồi quy, dữ liệu đầu vào đo hiệu năng, hướng dẫn vận hành máy chủ và triển khai, cùng minh chứng bảo mật và kiểm duyệt. `TF32-baseline-fp-audit.md` cần tệp minh chứng JSON đi kèm. README kiểm thử tải dẫn đến kết quả theo đầu việc. Hai ảnh PNG kiến trúc được xuất từ các sơ đồ nguồn tương ứng.
- Đã đối chiếu khai báo phụ thuộc TypeScript với mã nguồn, script và cấu hình công cụ được Git theo dõi. Worker Go import trực tiếp AWS SDK, Smithy, Redis và `errgroup`. Tệp mô-đun vẫn cố định các phụ thuộc gián tiếp. Chưa có căn cứ để bỏ phụ thuộc trực tiếp. Việc rà soát các thành phần có vẻ trùng nhau đã tính đến gói workspace riêng, đăng ký khi chạy, điểm truy cập đầu việc và tham chiếu CI/triển khai.
- Không thấy tệp được Git theo dõi trong các thư mục bộ nhớ đệm, build, báo cáo kiểm thử hoặc phụ thuộc phổ biến đã rà soát. Các thư mục bộ nhớ đệm và đầu ra build cục bộ hiện có đã được bỏ qua.

## Xác minh nếu phạm vi thực hiện thay đổi

1. Chạy `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:int` với Docker và `pnpm build`. Ghi nhận lỗi tại mốc ban đầu trước khi sửa.
2. Chạy `pnpm contracts:build` và đối chiếu hợp đồng được sinh với mốc đã đồng bộ. Kiểm tra quy trình build của cả hai worker, chạy `go test ./...` trong thư mục worker Go theo các điều kiện đã ghi trong tài liệu và xác thực cấu hình Compose cục bộ.
3. Kiểm tra các tuyến và hợp đồng, dữ liệu khởi tạo, thông tin giấy phép, liên kết tài liệu và đường dẫn workflow. Ghi kết quả vào `docs/maintenance/REPOSITORY_CLEANUP_REPORT.md`. Ghi riêng kích thước lịch sử Git, nội dung được theo dõi, phụ thuộc đã cài và đầu ra build.

**Chờ phê duyệt.** Kế hoạch này là thay đổi duy nhất trong bản làm việc. Chưa chạy kiểm tra lúc thực thi và kiểm tra build.

## Kiểm kê tài liệu và minh chứng

Kiểm kê 244 đường dẫn được Git theo dõi tại mốc đối chiếu, gồm các tệp trong `docs/` và tệp Markdown ở những thư mục khác. Minh chứng đầu việc được giữ theo quy định của kho mã. Các dòng cần xem xét phải được người phụ trách xác nhận hoặc có quyết định về lưu trữ trước khi xóa.

<details>
<summary>Phân loại từng tệp</summary>

| Đường dẫn | Byte | Phân loại | Căn cứ |
| --- | ---: | --- | --- |
| `.github/pull_request_template.md` | 670 | PHẢI GIỮ | Hướng dẫn cài đặt, quy định kho mã hoặc tài liệu tham chiếu triển khai |
| `ARCHITECTURE.md` | 2,301 | PHẢI GIỮ | Hướng dẫn cài đặt, quy định kho mã hoặc tài liệu tham chiếu triển khai |
| `CLAUDE.md` | 10 | PHẢI GIỮ | Hướng dẫn cài đặt, quy định kho mã hoặc tài liệu tham chiếu triển khai |
| `README.md` | 6,205 | PHẢI GIỮ | Hướng dẫn cài đặt, quy định kho mã hoặc tài liệu tham chiếu triển khai |
| `RULES.md` | 16,777 | PHẢI GIỮ | Hướng dẫn cài đặt, quy định kho mã hoặc tài liệu tham chiếu triển khai |
| `apps/core-api/src/modules/access/README.md` | 34,808 | PHẢI GIỮ | Hướng dẫn cài đặt, quy định kho mã hoặc tài liệu tham chiếu triển khai |
| `apps/core-api/src/modules/analytics/README.md` | 1,242 | PHẢI GIỮ | Hướng dẫn cài đặt, quy định kho mã hoặc tài liệu tham chiếu triển khai |
| `apps/core-api/src/modules/commerce/README.md` | 1,507 | PHẢI GIỮ | Hướng dẫn cài đặt, quy định kho mã hoặc tài liệu tham chiếu triển khai |
| `apps/core-api/src/modules/content/README.md` | 2,870 | PHẢI GIỮ | Hướng dẫn cài đặt, quy định kho mã hoặc tài liệu tham chiếu triển khai |
| `apps/core-api/src/modules/discovery/README.md` | 21,176 | PHẢI GIỮ | Hướng dẫn cài đặt, quy định kho mã hoặc tài liệu tham chiếu triển khai |
| `apps/core-api/src/modules/discovery/recommend/eval/report.md` | 6,904 | PHẢI GIỮ | Hướng dẫn cài đặt, quy định kho mã hoặc tài liệu tham chiếu triển khai |
| `apps/core-api/src/modules/discovery/search/eval/README.md` | 5,839 | PHẢI GIỮ | Hướng dẫn cài đặt, quy định kho mã hoặc tài liệu tham chiếu triển khai |
| `apps/notification-service/README.md` | 6,660 | PHẢI GIỮ | Hướng dẫn cài đặt, quy định kho mã hoặc tài liệu tham chiếu triển khai |
| `apps/video-worker-go/README.md` | 4,363 | PHẢI GIỮ | Hướng dẫn cài đặt, quy định kho mã hoặc tài liệu tham chiếu triển khai |
| `deploy/SERVER.md` | 39,860 | PHẢI GIỮ | Hướng dẫn vận hành, đo hiệu năng hoặc đánh giá |
| `deploy/aws/README.md` | 7,325 | PHẢI GIỮ | Hướng dẫn vận hành, đo hiệu năng hoặc đánh giá |
| `deploy/traefik/README.md` | 3,040 | PHẢI GIỮ | Hướng dẫn vận hành, đo hiệu năng hoặc đánh giá |
| `docs/architecture/06-kien-truc-lop.drawio` | 33,556 | PHẢI GIỮ | Kiến trúc hoặc lịch sử thiết kế |
| `docs/architecture/06-kien-truc-lop.png` | 521,413 | PHẢI GIỮ | Kiến trúc hoặc lịch sử thiết kế |
| `docs/architecture/06-kien-truc-tong-quan.drawio` | 39,570 | PHẢI GIỮ | Kiến trúc hoặc lịch sử thiết kế |
| `docs/architecture/06-kien-truc-tong-quan.png` | 549,765 | PHẢI GIỮ | Kiến trúc hoặc lịch sử thiết kế |
| `docs/architecture/10-de-xuat-kien-truc-va-repo.md` | 44,206 | PHẢI GIỮ | Kiến trúc hoặc lịch sử thiết kế |
| `docs/architecture/10-nghiep-vu-kien-truc-feed.md` | 29,336 | PHẢI GIỮ | Kiến trúc hoặc lịch sử thiết kế |
| `docs/architecture/11-de-xuat-cau-truc-repo.md` | 45,977 | PHẢI GIỮ | Kiến trúc hoặc lịch sử thiết kế |
| `docs/architecture/README.md` | 869 | PHẢI GIỮ | Kiến trúc hoặc lịch sử thiết kế |
| `docs/decisions/2026-11-04-commerce-trong-core.md` | 8,386 | PHẢI GIỮ | Hồ sơ quyết định |
| `docs/evidence/2026-11-18-creator-comment-controls.md` | 4,846 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF05-xac-thuc-dang-nhap-bang-jwt.md` | 11,371 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF051-libs-outbox.md` | 5,650 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF052-transactional-testing-idempotency.md` | 5,448 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF053-access-transactional-outbox-writer.md` | 3,628 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF054-staff-lock.md` | 4,572 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF055-my-account.md` | 5,965 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF056-an-toan-phien-dang-nhap.md` | 1,796 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF056-ma-hoa-mat-khau.md` | 8,337 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF056-rang-buoc-refresh.md` | 1,576 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF056-web-refresh-cookie.md` | 5,386 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF057-password-reset.md` | 6,224 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF058-service-token.md` | 5,736 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF059-google-guest-merge.md` | 5,578 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF05A-gateway-rate-limit.md` | 3,014 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF05B-email-chao-mung.md` | 4,488 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF05C-kiem-tra-du-lieu-access.md` | 9,574 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF05D-xac-thuc-email.md` | 6,764 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF05E-ho-tro-nhieu-kid.md` | 2,042 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF05F-bo-audit-refresh.md` | 1,776 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF05G-gioi-han-phien-va-bao-dung-lai.md` | 3,090 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF05G-ma-xac-thuc-dang-nhap.md` | 2,365 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF05H-format-mail-dang-nhap.md` | 3,210 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF05I-admin-dung-chung-phien-web.md` | 2,755 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF06-kho-san-pham-commerce.md` | 7,084 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF06M-ho-so-ca-nhan.md` | 3,632 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF06O-dang-ky-ho-so.md` | 2,913 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF07-giu-bo-dem-khi-seed.md` | 3,355 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF07-load-test-dang-nhap.md` | 3,731 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF07-seed-posts-and-comments.md` | 4,904 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF07-tao-bo-bai-dang-mo-phong.md` | 2,163 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF07-traefik-access-log.md` | 2,372 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF09-aws-dev-media.md` | 3,031 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF09-cdn-images.md` | 2,022 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF09-ffmpeg-spec-windows.md` | 1,758 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF09-fix-content-migration-chain.md` | 1,691 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF09-libs-storage.md` | 2,205 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF09-media-complete.md` | 4,119 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF09-media-playback.md` | 4,184 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF09-media-schema.md` | 3,437 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF09-media-upload-api.md` | 4,051 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF09-outbox-relay-stream.md` | 2,639 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF09-video-worker.md` | 4,921 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF10-danh-gia-khach-san.md` | 5,821 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF10-mobile-reel-ux.md` | 4,206 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF10-reel-mau-1000.md` | 7,335 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF10-trang-chi-tiet-khach-san.md` | 6,780 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF100-admin-realtime.md` | 3,324 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF100-luat-du-chuyen-khoan-ngoai-app.md` | 3,619 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF101-khong-thong-bao-tu-an.md` | 3,074 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF101-postvisibility-su-kien-binh-luan.md` | 3,334 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF101-tac-gia-thay-binh-luan-an.md` | 2,466 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF102-khoang-trong-tu-vung.md` | 3,539 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF103-doi-chu-ky-reindex.md` | 4,451 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF103-sua-race-edit-comment.md` | 2,097 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF105-lo-trinh-khi-dang-bai.md` | 2,729 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF106-luu-so-thich-onboarding.md` | 3,769 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF107-nap-du-lieu-mo-phong-goi-y.md` | 9,412 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF108-diem-hoan-thien-va-sort.md` | 7,641 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF109-anh-dai-dien.md` | 3,265 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF109-luu-phu-kien-avatar.md` | 2,069 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF11-gioi-han-ung-vien-search.md` | 5,493 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF11-index-diem-tham-quan.md` | 5,348 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF11-loc-sao-va-gia-giam.md` | 2,457 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF11-ota-suggest.md` | 5,821 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF11-search-diem-mem-fallback.md` | 9,459 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF11-tim-bai-viet.md` | 4,439 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF11-tim-kham-pha.md` | 4,524 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF111-diem-hot-feed.md` | 5,417 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF117-admin-moderation-filters.md` | 2,211 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF12-goi-y-trang-chu.md` | 2,808 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF13-bo-cau-tim-kiem.md` | 3,496 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF14-an-canh-bao-cho-duyet.md` | 1,893 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF22-feed-api.md` | 2,918 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF22-feed-hot-tab.md` | 3,057 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF22-feed-seed.md` | 2,317 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF23-diem-xu-huong-reels.md` | 4,384 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF23-su-kien-xem-reels.md` | 4,251 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF24-comment-flat-and-ai-summary.md` | 10,939 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF24-dang-bai-video-vlog-kem-lo-trinh.md` | 2,937 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF24-facade-list-posts.md` | 3,827 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF24-fix-auth-controllers-facade.md` | 5,015 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF24-fix-domain-business-rules.md` | 3,209 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF24-strict-outbox-stream-selector.md` | 3,007 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF24-transactional-outbox.md` | 5,946 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF25-anh-bai-viet.md` | 5,945 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF25-chan-chia-se-bai-an.md` | 1,634 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF25-chan-tuong-tac-bai-an-va-an-pii.md` | 2,657 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF25-comment-reactions.md` | 12,949 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF25-deprecate-keyword-posts.md` | 1,782 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF25-don-bai-viet-gan-video.md` | 2,941 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF25-go-keyword-posts.md` | 1,667 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF25-share-url-theo-moi-truong.md` | 3,194 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF25-tach-reels-va-bai-viet.md` | 3,221 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF25-tag-nguoi-dung-be.md` | 9,751 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF25-ten-tac-gia-bai-viet.md` | 2,351 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF25-ten-tac-gia-binh-luan.md` | 2,436 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF25-thong-bao-tag.md` | 2,813 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF25-tra-loi-trich-dan-be.md` | 4,769 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF25-tuong-tac-bai-dang-app-web.md` | 2,666 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF25-viewer-context-bai-da-luu.md` | 1,844 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF25-viewer-context-danh-sach-bai-viet.md` | 2,698 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF26A-websocket.md` | 4,697 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF27-loc-noi-khong-loai-bai-chua-ro-noi.md` | 3,556 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF28-ai-ram.md` | 1,654 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF28-bai-tuong-tac-khong-bi-an.md` | 5,977 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF28-co-chuyen-van-goi-y-noi-vua-tim.md` | 2,993 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF28-for-you-v1.md` | 10,122 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF28-giam-tai-goi-y.md` | 4,977 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF28-goi-y-theo-tin-hieu-vua-xay-ra.md` | 6,035 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF28-job-run-bi-ngat.md` | 2,596 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF28-khung-recommend.md` | 6,613 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF28-libs-auth-su-kien-tim-kiem.md` | 3,571 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF28-mot-nguon-dia-diem.md` | 12,714 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF29-bo-sung-chuyen-bay.md` | 4,772 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF29-booking-khi-redis-loi.md` | 1,781 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF29-dat-cho-thanh-toan-gia-lap.md` | 10,210 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF29-gioi-han-cho-khoa.md` | 849 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF29-lich-nap-tang-dan-tra-tien.md` | 3,586 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF29-lo-trinh-mau.md` | 1,336 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF29-tre-em-em-be.md` | 5,862 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF30-giu-cho-30-phut.md` | 7,361 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF30-sua-ton-kho-k1-k4.md` | 3,760 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF31-diem-tham-quan.md` | 4,342 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF31-luna-reasoning.md` | 2,201 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF31-router-chat.md` | 2,513 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF31-seed-vung-tau.md` | 7,449 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF31-tom-tat-204.md` | 2,161 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF32-BE09-video-frames.md` | 2,004 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF32-baseline-fp-audit.json` | 9,206 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF32-baseline-fp-audit.md` | 9,273 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF32-be09-dot1-20261119.md` | 5,955 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF32-be10-phan-cong-kiem-duyet.md` | 7,440 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF32-creator-controls-be.md` | 1,291 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF32-hang-cho-kiem-duyet.md` | 5,566 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF33-bao-ve-comment-stats-va-regex-uuid-doi-soat.md` | 3,111 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF33-lay-mau-binh-luan-va-doi-soat-ai.md` | 3,564 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF33-outbox-post-updated.md` | 2,403 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF33-security-header-http.md` | 2,746 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF33-xoa-bai-an-khoi-search.md` | 5,816 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF37-chuyen-di-cua-toi.md` | 5,682 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF37-link-don-trong-mail.md` | 1,739 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF37-mail-gui-lai-va-giao-dien.md` | 3,634 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF37-mail-xac-nhan-dat-cho.md` | 1,599 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF38-dau-da-xac-thuc-quyen-rieng-tu-lo-trinh.md` | 2,821 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF39-goi-y-phan-con-thieu.md` | 3,932 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF43-don-bat-thuong-quan-tri.md` | 3,315 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF44-ai-summary-checked-at.md` | 5,779 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF44-comment-restored-payload.md` | 2,891 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF45-chia-se-mang-xa-hoi-deep-link.md` | 2,079 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF46-follow-bai-moi.md` | 2,249 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF46-inbox-dung-chung.md` | 1,757 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF46-push-mobile.md` | 4,067 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF46-theo-doi-bai-da-binh-luan.md` | 4,368 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF46-theo-doi-luong-tra-loi.md` | 3,797 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF46-web-push.md` | 5,548 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF46A-schema-notification.md` | 2,708 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF46B-handler-va-directory.md` | 1,563 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF46C-api-hop-thong-bao.md` | 1,763 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF46D-lien-ket-binh-luan.md` | 1,788 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF46D-thong-bao-binh-luan.md` | 2,128 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF46D-tra-loi-trong-luong.md` | 1,213 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF46E-gom-thong-bao-cam-xuc.md` | 3,175 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF46E-trich-binh-luan.md` | 1,931 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF46F-thong-bao-kiem-duyet-video.md` | 2,730 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF47-trang-ca-nhan-cong-khai.md` | 1,986 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF57-gop-db-commerce-vao-core.md` | 4,865 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF57-tach-ai-khoi-stack.md` | 3,574 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF57-turbo-dev-trong-docker.md` | 3,079 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF64-cors-admin.md` | 2,828 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF66-slug-khach-san.md` | 1,879 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF67-slug-khach-san-discovery.md` | 3,598 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF68-sua-ci-cd.md` | 2,010 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF69-checkout-loi-tung-o.md` | 3,359 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF70-vnpay-refund.md` | 9,148 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF82-cookie-video.md` | 5,741 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF82-mo-khoa-video-dev.md` | 4,060 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF87-admin-hien-ten-tac-gia.md` | 2,789 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF88-tu-an-noi-dung-vi-pham.md` | 4,184 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF89-thong-ke-kiem-duyet-server.md` | 3,555 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF90-trang-thai-held.md` | 5,765 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF91-giu-noi-dung-truoc-public.md` | 5,122 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF92-duyet-binh-luan-be.md` | 3,939 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF93-luat-chui-tuc-xet-dau.md` | 4,302 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF94-tai-lieu-kien-truc.md` | 1,233 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF95-analytics-ai-usage.md` | 5,027 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF95-search-article-the-bai.md` | 3,496 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF99-benchmark-binh-luan.md` | 9,691 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF99-binh-luan-realtime.md` | 3,701 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF99-chi-lay-ten-hien-thi.md` | 2,304 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF99-dem-so-binh-luan-bai-nong.md` | 7,161 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF99-giam-truy-van-doc-binh-luan.md` | 4,482 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF99-index-binh-luan.md` | 5,223 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF99-opentelemetry-tracing.md` | 4,652 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF99-post-visibility-contract.md` | 2,410 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF99-rut-ngan-khoa-dong-bai.md` | 3,704 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TF99-sua-cursor-binh-luan.md` | 3,648 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TFxx-an-preflight-traces.md` | 1,995 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TFxx-fix-preflight-tempo.md` | 1,339 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/TFxx-thumbnail-tim-video.md` | 2,977 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/analytics-observability.md` | 4,973 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/api-integration.md` | 2,603 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/evidence/video-worker-go.md` | 5,492 | PHẢI GIỮ | Minh chứng đầu việc, nghiệm thu hoặc kiểm thử hồi quy |
| `docs/observability.md` | 8,161 | PHẢI GIỮ | Hướng dẫn cài đặt, quy định kho mã hoặc tài liệu tham chiếu triển khai |
| `docs/security/SECURITY_AUDIT_REPORT.md` | 42,826 | PHẢI GIỮ | Hồ sơ bảo mật |
| `docs/security/SECURITY_REMEDIATION_PLAN.md` | 19,782 | PHẢI GIỮ | Hồ sơ bảo mật |
| `docs/social_content/API_ENDPOINTS.md` | 26,587 | CẦN XEM XÉT | Xem phần đánh giá từng tệp ở trên |
| `docs/social_content/ROADMAP_AND_PROPOSALS.md` | 18,154 | CẦN XEM XÉT | Xem phần đánh giá từng tệp ở trên |
| `libs/auth/README.md` | 3,220 | PHẢI GIỮ | Hướng dẫn cài đặt, quy định kho mã hoặc tài liệu tham chiếu triển khai |
| `libs/db/README.md` | 3,390 | PHẢI GIỮ | Hướng dẫn cài đặt, quy định kho mã hoặc tài liệu tham chiếu triển khai |
| `libs/idempotency/README.md` | 2,835 | PHẢI GIỮ | Hướng dẫn cài đặt, quy định kho mã hoặc tài liệu tham chiếu triển khai |
| `libs/observability/README.md` | 2,335 | PHẢI GIỮ | Hướng dẫn cài đặt, quy định kho mã hoặc tài liệu tham chiếu triển khai |
| `libs/outbox/README.md` | 4,573 | PHẢI GIỮ | Hướng dẫn cài đặt, quy định kho mã hoặc tài liệu tham chiếu triển khai |
| `libs/storage/README.md` | 1,246 | PHẢI GIỮ | Hướng dẫn cài đặt, quy định kho mã hoặc tài liệu tham chiếu triển khai |
| `libs/testing/README.md` | 1,955 | PHẢI GIỮ | Hướng dẫn cài đặt, quy định kho mã hoặc tài liệu tham chiếu triển khai |
| `tools/bench/comments/README.md` | 3,714 | PHẢI GIỮ | Hướng dẫn vận hành, đo hiệu năng hoặc đánh giá |
| `tools/bench/feed/README.md` | 8,875 | PHẢI GIỮ | Hướng dẫn vận hành, đo hiệu năng hoặc đánh giá |
| `tools/loadtest/README.md` | 2,892 | PHẢI GIỮ | Hướng dẫn vận hành, đo hiệu năng hoặc đánh giá |

</details>
