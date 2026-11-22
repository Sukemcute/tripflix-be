# Báo cáo dọn dẹp kho mã backend Tripflix

Thực hiện ngày 22/11/2026 trên nhánh `chore/repository-deep-cleanup`. Mốc đối chiếu là `7120e5869328978ea2f15bd417af4762d2950840` của `origin/develop`.

## Kết quả

- Xóa **75 tệp minh chứng** trong `docs/evidence`, giảm **297.695 byte**. Dùng mốc hết ngày 15/11/2026 theo giờ UTC+7, dựa vào ngày tác giả của commit cập nhật gần nhất không phải commit merge. Với các đường dẫn chỉ xuất hiện khi merge, dùng ngày ghi nhận chúng trong lịch sử Git.
- Giữ nguyên toàn bộ `docs/social_content`, gồm `API_ENDPOINTS.md` và `ROADMAP_AND_PROPOSALS.md`. Giữ cả năm tệp minh chứng mà lộ trình dẫn tới.
- Giữ đủ 87 tệp từ 16–22/11 và 41 tệp cũ cần cho bảo mật, quyền riêng tư, kiểm duyệt, vận hành hoặc tái lập kiểm thử. Tổng cộng còn 128 tệp trong `docs/evidence`.
- Giữ nguyên mã nguồn, hợp đồng API và sự kiện, dữ liệu khởi tạo, hồ sơ bảo mật, cấu hình triển khai, tài nguyên, phụ thuộc và lockfile. Không phát sinh thay đổi ở frontend hoặc AI trong lượt này.

## Đo dung lượng

| Chỉ số | Trước | Sau |
| --- | ---: | ---: |
| Đường dẫn tại mốc đối chiếu còn trong bản làm việc | 1.482 | 1.407 |
| Byte của các tệp tại mốc đối chiếu còn trong bản làm việc | 34.837.615 | 34.539.920 |
| Đối tượng Git đã đóng gói | 20.939 KiB | 20.939 KiB |
| Đối tượng Git rời | 1.291 KiB | 1.291 KiB |

Mức giảm 297.695 byte tính theo kích thước tệp được Git theo dõi ở mốc đối chiếu. Hai tài liệu bảo trì mới chưa được Git theo dõi nên được để ngoài phép tính này. Việc dọn dẹp không làm thay đổi lịch sử Git hay cấu hình phụ thuộc. Thư mục phụ thuộc và đầu ra build nằm ngoài phép đo.

## Xác minh

- `git diff --check` đạt. Đã đối chiếu diff để xác nhận mọi tệp bị xóa thuộc `docs/evidence`, năm tham chiếu của lộ trình còn đích, và cây mã nguồn, tài liệu `social_content`, hợp đồng, cấu hình triển khai và lockfile không đổi.
- `pnpm install --frozen-lockfile` thành công. Lint, kiểm tra kiểu, build và kiểm tra ranh giới mô-đun đạt. Lượt kiểm tra đầu hoàn tất 51/52 tác vụ. Tác vụ `core-api:test` có 3.121 bài đạt, 4 bài bỏ qua và một bài kiểm tra dữ liệu reel mẫu vượt giới hạn 5 giây.
- Chạy lại toàn bộ bộ kiểm thử `core-api` với `--maxWorkers=4` đạt 3.122 bài trên 185 tệp, với 4 bài bỏ qua theo cấu hình kiểm thử.
- `docker compose -f deploy/compose.yaml config --quiet` đạt. Chưa chạy kiểm thử tích hợp dựa trên Docker vì Docker Engine chưa hoạt động. Chưa chạy bộ kiểm thử worker Go vì môi trường không có lệnh `go`.

## Minh chứng cũ được giữ

<details>
<summary>41 tệp được giữ</summary>

| Tệp | Lý do |
| --- | --- |
| `docs/evidence/TF05-xac-thuc-dang-nhap-bang-jwt.md` | Xác thực, quản lý phiên, phân quyền và quyền riêng tư |
| `docs/evidence/TF054-staff-lock.md` | Xác thực, quản lý phiên, phân quyền và quyền riêng tư |
| `docs/evidence/TF056-an-toan-phien-dang-nhap.md` | Xác thực, quản lý phiên, phân quyền và quyền riêng tư |
| `docs/evidence/TF056-ma-hoa-mat-khau.md` | Xác thực, quản lý phiên, phân quyền và quyền riêng tư |
| `docs/evidence/TF056-rang-buoc-refresh.md` | Xác thực, quản lý phiên, phân quyền và quyền riêng tư |
| `docs/evidence/TF056-web-refresh-cookie.md` | Xác thực, quản lý phiên, phân quyền và quyền riêng tư |
| `docs/evidence/TF057-password-reset.md` | Xác thực, quản lý phiên, phân quyền và quyền riêng tư |
| `docs/evidence/TF058-service-token.md` | Xác thực, quản lý phiên, phân quyền và quyền riêng tư |
| `docs/evidence/TF059-google-guest-merge.md` | Xác thực, quản lý phiên, phân quyền và quyền riêng tư |
| `docs/evidence/TF05A-gateway-rate-limit.md` | Xác thực, quản lý phiên, phân quyền và quyền riêng tư |
| `docs/evidence/TF05C-kiem-tra-du-lieu-access.md` | Xác thực, quản lý phiên, phân quyền và quyền riêng tư |
| `docs/evidence/TF05D-xac-thuc-email.md` | Xác thực, quản lý phiên, phân quyền và quyền riêng tư |
| `docs/evidence/TF05E-ho-tro-nhieu-kid.md` | Xác thực, quản lý phiên, phân quyền và quyền riêng tư |
| `docs/evidence/TF05F-bo-audit-refresh.md` | Xác thực, quản lý phiên, phân quyền và quyền riêng tư |
| `docs/evidence/TF05G-gioi-han-phien-va-bao-dung-lai.md` | Xác thực, quản lý phiên, phân quyền và quyền riêng tư |
| `docs/evidence/TF05G-ma-xac-thuc-dang-nhap.md` | Xác thực, quản lý phiên, phân quyền và quyền riêng tư |
| `docs/evidence/TF06O-dang-ky-ho-so.md` | Xác thực, quản lý phiên, phân quyền và quyền riêng tư |
| `docs/evidence/TF07-seed-posts-and-comments.md` | Tái lập dữ liệu thử và xác minh vận hành |
| `docs/evidence/TF07-tao-bo-bai-dang-mo-phong.md` | Các tệp được dẫn trực tiếp từ lộ trình social_content |
| `docs/evidence/TF09-aws-dev-media.md` | Tái lập dữ liệu thử và xác minh vận hành |
| `docs/evidence/TF09-cdn-images.md` | Tái lập dữ liệu thử và xác minh vận hành |
| `docs/evidence/TF09-ffmpeg-spec-windows.md` | Tái lập dữ liệu thử và xác minh vận hành |
| `docs/evidence/TF09-fix-content-migration-chain.md` | Tái lập dữ liệu thử và xác minh vận hành |
| `docs/evidence/TF13-bo-cau-tim-kiem.md` | Kiểm duyệt, kiểm tra hồi quy và đánh giá |
| `docs/evidence/TF14-an-canh-bao-cho-duyet.md` | Kiểm duyệt, kiểm tra hồi quy và đánh giá |
| `docs/evidence/TF24-dang-bai-video-vlog-kem-lo-trinh.md` | Các tệp được dẫn trực tiếp từ lộ trình social_content |
| `docs/evidence/TF24-fix-auth-controllers-facade.md` | Xác thực, quản lý phiên, phân quyền và quyền riêng tư |
| `docs/evidence/TF24-fix-domain-business-rules.md` | Xác thực, quản lý phiên, phân quyền và quyền riêng tư |
| `docs/evidence/TF25-chan-tuong-tac-bai-an-va-an-pii.md` | Xác thực, quản lý phiên, phân quyền và quyền riêng tư |
| `docs/evidence/TF25-tuong-tac-bai-dang-app-web.md` | Các tệp được dẫn trực tiếp từ lộ trình social_content |
| `docs/evidence/TF32-baseline-fp-audit.json` | Kiểm duyệt, kiểm tra hồi quy và đánh giá |
| `docs/evidence/TF32-baseline-fp-audit.md` | Kiểm duyệt, kiểm tra hồi quy và đánh giá |
| `docs/evidence/TF32-hang-cho-kiem-duyet.md` | Kiểm duyệt, kiểm tra hồi quy và đánh giá |
| `docs/evidence/TF33-bao-ve-comment-stats-va-regex-uuid-doi-soat.md` | Xác thực, quản lý phiên, phân quyền và quyền riêng tư |
| `docs/evidence/TF33-lay-mau-binh-luan-va-doi-soat-ai.md` | Kiểm duyệt, kiểm tra hồi quy và đánh giá |
| `docs/evidence/TF33-xoa-bai-an-khoi-search.md` | Xác thực, quản lý phiên, phân quyền và quyền riêng tư |
| `docs/evidence/TF38-dau-da-xac-thuc-quyen-rieng-tu-lo-trinh.md` | Các tệp được dẫn trực tiếp từ lộ trình social_content |
| `docs/evidence/TF45-chia-se-mang-xa-hoi-deep-link.md` | Các tệp được dẫn trực tiếp từ lộ trình social_content |
| `docs/evidence/TF70-vnpay-refund.md` | Tái lập dữ liệu thử và xác minh vận hành |
| `docs/evidence/TF88-tu-an-noi-dung-vi-pham.md` | Kiểm duyệt, kiểm tra hồi quy và đánh giá |
| `docs/evidence/video-worker-go.md` | Tái lập dữ liệu thử và xác minh vận hành |

</details>

## Danh sách tệp đã xóa

<details>
<summary>75 tệp minh chứng</summary>

| Tệp | Ngày cập nhật cuối | Byte |
| --- | --- | ---: |
| `docs/evidence/TF051-libs-outbox.md` | 04/11/2026 | 5.650 |
| `docs/evidence/TF052-transactional-testing-idempotency.md` | 04/11/2026 | 5.448 |
| `docs/evidence/TF053-access-transactional-outbox-writer.md` | 04/11/2026 | 3.628 |
| `docs/evidence/TF055-my-account.md` | 04/11/2026 | 5.965 |
| `docs/evidence/TF05B-email-chao-mung.md` | 05/11/2026 | 4.488 |
| `docs/evidence/TF05H-format-mail-dang-nhap.md` | 12/11/2026 | 3.210 |
| `docs/evidence/TF06-kho-san-pham-commerce.md` | 05/11/2026 | 7.084 |
| `docs/evidence/TF06M-ho-so-ca-nhan.md` | 06/11/2026 | 3.632 |
| `docs/evidence/TF07-giu-bo-dem-khi-seed.md` | 10/11/2026 | 3.355 |
| `docs/evidence/TF09-libs-storage.md` | 04/11/2026 | 2.205 |
| `docs/evidence/TF09-media-complete.md` | 05/11/2026 | 4.119 |
| `docs/evidence/TF09-media-playback.md` | 05/11/2026 | 4.184 |
| `docs/evidence/TF09-media-schema.md` | 04/11/2026 | 3.437 |
| `docs/evidence/TF09-media-upload-api.md` | 04/11/2026 | 4.051 |
| `docs/evidence/TF09-outbox-relay-stream.md` | 05/11/2026 | 2.639 |
| `docs/evidence/TF09-video-worker.md` | 05/11/2026 | 4.921 |
| `docs/evidence/TF10-danh-gia-khach-san.md` | 06/11/2026 | 5.821 |
| `docs/evidence/TF10-mobile-reel-ux.md` | 12/11/2026 | 4.206 |
| `docs/evidence/TF10-trang-chi-tiet-khach-san.md` | 06/11/2026 | 6.780 |
| `docs/evidence/TF11-loc-sao-va-gia-giam.md` | 06/11/2026 | 2.457 |
| `docs/evidence/TF11-ota-suggest.md` | 05/11/2026 | 5.821 |
| `docs/evidence/TF11-search-diem-mem-fallback.md` | 13/11/2026 | 9.459 |
| `docs/evidence/TF11-tim-bai-viet.md` | 06/11/2026 | 4.439 |
| `docs/evidence/TF11-tim-kham-pha.md` | 06/11/2026 | 4.524 |
| `docs/evidence/TF12-goi-y-trang-chu.md` | 08/11/2026 | 2.808 |
| `docs/evidence/TF22-feed-api.md` | 05/11/2026 | 2.918 |
| `docs/evidence/TF22-feed-hot-tab.md` | 06/11/2026 | 3.057 |
| `docs/evidence/TF22-feed-seed.md` | 05/11/2026 | 2.317 |
| `docs/evidence/TF24-comment-flat-and-ai-summary.md` | 05/11/2026 | 10.939 |
| `docs/evidence/TF24-facade-list-posts.md` | 05/11/2026 | 3.827 |
| `docs/evidence/TF24-strict-outbox-stream-selector.md` | 05/11/2026 | 3.007 |
| `docs/evidence/TF24-transactional-outbox.md` | 05/11/2026 | 5.946 |
| `docs/evidence/TF25-anh-bai-viet.md` | 13/11/2026 | 5.945 |
| `docs/evidence/TF25-comment-reactions.md` | 05/11/2026 | 12.949 |
| `docs/evidence/TF25-deprecate-keyword-posts.md` | 12/11/2026 | 1.782 |
| `docs/evidence/TF25-share-url-theo-moi-truong.md` | 13/11/2026 | 3.194 |
| `docs/evidence/TF25-tach-reels-va-bai-viet.md` | 12/11/2026 | 3.221 |
| `docs/evidence/TF25-ten-tac-gia-bai-viet.md` | 09/11/2026 | 2.351 |
| `docs/evidence/TF25-ten-tac-gia-binh-luan.md` | 09/11/2026 | 2.436 |
| `docs/evidence/TF25-viewer-context-danh-sach-bai-viet.md` | 11/11/2026 | 2.698 |
| `docs/evidence/TF26A-websocket.md` | 10/11/2026 | 4.697 |
| `docs/evidence/TF28-khung-recommend.md` | 13/11/2026 | 6.613 |
| `docs/evidence/TF28-libs-auth-su-kien-tim-kiem.md` | 12/11/2026 | 3.571 |
| `docs/evidence/TF29-bo-sung-chuyen-bay.md` | 06/11/2026 | 4.772 |
| `docs/evidence/TF29-booking-khi-redis-loi.md` | 09/11/2026 | 1.781 |
| `docs/evidence/TF29-dat-cho-thanh-toan-gia-lap.md` | 05/11/2026 | 10.210 |
| `docs/evidence/TF29-gioi-han-cho-khoa.md` | 09/11/2026 | 849 |
| `docs/evidence/TF29-lo-trinh-mau.md` | 13/11/2026 | 1.336 |
| `docs/evidence/TF29-tre-em-em-be.md` | 08/11/2026 | 5.862 |
| `docs/evidence/TF30-giu-cho-30-phut.md` | 05/11/2026 | 7.361 |
| `docs/evidence/TF33-outbox-post-updated.md` | 09/11/2026 | 2.403 |
| `docs/evidence/TF37-chuyen-di-cua-toi.md` | 05/11/2026 | 5.682 |
| `docs/evidence/TF37-link-don-trong-mail.md` | 10/11/2026 | 1.739 |
| `docs/evidence/TF37-mail-gui-lai-va-giao-dien.md` | 10/11/2026 | 3.634 |
| `docs/evidence/TF37-mail-xac-nhan-dat-cho.md` | 09/11/2026 | 1.599 |
| `docs/evidence/TF44-ai-summary-checked-at.md` | 13/11/2026 | 5.779 |
| `docs/evidence/TF44-comment-restored-payload.md` | 13/11/2026 | 2.891 |
| `docs/evidence/TF46-follow-bai-moi.md` | 13/11/2026 | 2.249 |
| `docs/evidence/TF46-inbox-dung-chung.md` | 13/11/2026 | 1.757 |
| `docs/evidence/TF46A-schema-notification.md` | 12/11/2026 | 2.708 |
| `docs/evidence/TF46B-handler-va-directory.md` | 12/11/2026 | 1.563 |
| `docs/evidence/TF46C-api-hop-thong-bao.md` | 12/11/2026 | 1.763 |
| `docs/evidence/TF46D-lien-ket-binh-luan.md` | 12/11/2026 | 1.788 |
| `docs/evidence/TF46D-thong-bao-binh-luan.md` | 12/11/2026 | 2.128 |
| `docs/evidence/TF46D-tra-loi-trong-luong.md` | 13/11/2026 | 1.213 |
| `docs/evidence/TF46E-gom-thong-bao-cam-xuc.md` | 12/11/2026 | 3.175 |
| `docs/evidence/TF46F-thong-bao-kiem-duyet-video.md` | 12/11/2026 | 2.730 |
| `docs/evidence/TF57-gop-db-commerce-vao-core.md` | 05/11/2026 | 4.865 |
| `docs/evidence/TF57-tach-ai-khoi-stack.md` | 07/11/2026 | 3.574 |
| `docs/evidence/TF57-turbo-dev-trong-docker.md` | 06/11/2026 | 3.079 |
| `docs/evidence/TF66-slug-khach-san.md` | 09/11/2026 | 1.879 |
| `docs/evidence/TF68-sua-ci-cd.md` | 07/11/2026 | 2.010 |
| `docs/evidence/TF69-checkout-loi-tung-o.md` | 08/11/2026 | 3.359 |
| `docs/evidence/TF89-thong-ke-kiem-duyet-server.md` | 14/11/2026 | 3.555 |
| `docs/evidence/api-integration.md` | 05/11/2026 | 2.603 |

</details>
