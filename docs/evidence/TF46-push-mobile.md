# TF46 — Push mobile phía server (N3)

- Notion: TF46 (N3 theo yêu cầu của anh Thành) · Nhánh: `dung/TF46-push-mobile` (phụ thuộc PR #198) · Người làm: Dũng (dùng AI: có) · Ngày: 2026-11-16

## Mục đích
Điện thoại hiện thông báo đẩy khi có thông báo mới, kể cả khi app đang đóng. Ví dụ: Trang trả lời bình luận của bạn thì điện thoại báo "Trang đã trả lời bình luận của bạn", bấm vào mở đúng bài. PR này là phần server; app (Trang) lấy Expo push token và gửi lên.

## Đã làm
- Migration notification số 10: bảng `push_tokens`; cột `inbox.updated_at` với trigger chỉ đổi khi tiêu đề hoặc nội dung đổi (dòng cũ để NULL nên lần triển khai đầu không đẩy lại thông báo cũ); chỉ mục `uq_deliveries_inbox_push` để mỗi dòng có một bản ghi push trong `deliveries`.
- API (đăng nhập): `POST /notifications/push-tokens` body `{ token, platform: 'android' | 'ios' }`; `DELETE /notifications/push-tokens` body `{ token }`. Token phải đúng dạng `ExponentPushToken[...]`. Đổi tài khoản trên cùng máy thì token chuyển sang tài khoản mới; mỗi người giữ tối đa 10 máy.
- `PushWorker` mỗi 2 giây: lấy tối đa 100 dòng inbox mới hoặc vừa đổi nội dung trong 10 phút, chưa đọc, chưa ẩn, của người có máy; gửi Expo Push API bằng `fetch` (không thêm thư viện), mỗi lần tối đa 100 tin. Dòng gom chỉ đẩy lại sau 3 phút.
- Kết quả ghi vào `deliveries` (`sent`/`failed`). Expo lỗi cũng ghi `failed` để chờ hết 3 phút mới thử, không gọi dồn. `DeviceNotRegistered` thì xoá token.
- `access.user.locked` thì xoá mọi token của người đó.
- Env mới: `PUSH_ENABLED` (mặc định `false`), `EXPO_PUSH_URL`, `EXPO_ACCESS_TOKEN` (tuỳ chọn).

## Đối chiếu "Xong khi"
| Tiêu chí (theo yêu cầu anh Thành) | Đạt | Bằng chứng |
|---|---|---|
| `POST /notifications/push-tokens` để app gửi Expo push token | Có | `push.int.spec.ts` — "token chuyển sang tài khoản mới, mỗi người giữ tối đa 10 máy…" |
| Ghi inbox xong thì gọi Expo Push API bằng HTTP | Có | "đẩy dòng mới tới mọi máy của người nhận một lần…" |
| Token DeviceNotRegistered thì xoá | Có | "Expo báo DeviceNotRegistered thì xoá máy đó…" |
| Mỗi dòng đã gom chỉ đẩy một lần trong vài phút | Có | "dòng gom có thêm người: chờ hết 3 phút mới đẩy lại…" |
| Không đẩy dòng đã đọc, đã ẩn, có từ trước khi bật | Có | "không đẩy dòng đã đọc, đã ẩn…" |

## Kết quả kiểm tra
- `vitest run --config vitest.int.config.ts` (notification-service, Postgres thật): 10 file, 47/47 pass.
- `vitest run` (notification-service): 16 file, 112/112 pass.
- `pnpm turbo run lint typecheck test --affected --continue --concurrency=2`: 49/49 task pass.

## Cách kiểm lại
1. Bật Docker.
2. `cd apps/notification-service && npx vitest run --config vitest.int.config.ts src/push`

## Ảnh / video
- Không đổi giao diện.

## Ảnh hưởng tới phần của người khác
- Chỉ sửa `notification-service` (Dũng). Sửa thêm hai helper test (`realtime.test-helpers.ts`, `me.e2e.spec.ts`) vì khai báo env đầy đủ bằng tay.
- App (Trang): gọi `POST /notifications/push-tokens` sau khi đăng nhập và khi token đổi, `DELETE` khi đăng xuất. Bấm thông báo mở `data.link`.
- Deploy (Phong): đặt `PUSH_ENABLED=true` (và `EXPO_ACCESS_TOKEN` nếu bật Enhanced Push Security) khi app sẵn sàng; khoá Firebase cấu hình trên Expo, server không giữ.
- Giới hạn: thông báo bài mới dùng chung (tác giả đông follower) không có dòng thật nên không có push; chưa đọc receipts của Expo (token hỏng phát hiện muộn sẽ xoá ở lần gửi sau); worker dừng quá 10 phút thì dòng cũ hơn không đẩy nữa.
