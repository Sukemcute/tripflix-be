# TF30 — Giữ chỗ 30 phút: job nhả chỗ quá hạn

- Notion: <dán link task TF30> · Nhánh: `thang/TF30-giu-cho-30-phut` (tạo từ `develop`) · Người làm: Thắng Nguyễn Lê Phúc (dùng AI: có) · Ngày: 2026-11-05

## Đã làm
- **Job nhả chỗ** (`ExpireHoldsJob`, mỗi phút, chỉ khi `APP_ROLE` là `worker` hoặc `all`). Mỗi đơn một transaction, khoá bằng `FOR UPDATE SKIP LOCKED` nên nhiều bản core-api không làm trùng.

| Đơn quá hạn giữ chỗ | Xử lý |
|---|---|
| `pending` | Sang `expired`, trả chỗ |
| `paying`, khoản `requires_action` (bỏ OTP) | Khoản `failed` (`3ds_expired`), đơn `expired`, trả chỗ |
| `paying`, VNPay `initiated`, đã quá 15 phút hạn của trang VNPay | Khoản `failed` (`vnpay_expired`), đơn `expired`, trả chỗ |
| `paying`, thẻ `initiated` (chưa rõ kết quả) | Không đụng, để đối soát quyết định |

- **Không deadlock với TX2:** `applyResult` khoá khoản trừ rồi mới khoá đơn, job khoá đơn trước. Vì vậy job dùng SKIP LOCKED cho cả hai hàng, không bao giờ chờ; hàng đang bị giữ thì bỏ qua, lần chạy sau xét lại.
- **Không deadlock khi nhả và bán chỗ:** `releaseOrder` và `applyResult` giờ đi qua các ô theo đúng thứ tự (sản phẩm, ngày) như lúc giữ chỗ (`listSortedCells`). Trước đây đi theo ngày, nên giỏ nhiều mục có thể deadlock với người đang giữ chỗ.
- **Đơn thẻ chờ đối soát không chiếm chỗ trong lô:** câu truy vấn lọc sẵn, job còn xét lại mọi điều kiện sau khi khoá vì danh sách đọc không khoá.
- **Sửa lỗi VNPay báo thành công cho khoản đã `failed`:** trước đây IPN trả `02` và bỏ qua, nên tiền đã trừ mà không có khoản hoàn. Giờ:
  - Ghi mã giao dịch; khoản vẫn `failed`, để không vi phạm `uq_payments_one_live_per_order` khi đơn đang có khoản khác còn sống. Không đụng đơn và chỗ.
  - Tạo khoản hoàn với khoá theo từng khoản trừ (`refund:late:<paymentId>`, lý do `late_success`), không đụng khoá hoàn theo đơn.
  - Chuyển người xử lý (`needs_review = true`) ngay trong TX2, nên server chết ngay sau đó cũng không mất dấu.
  - IPN trả `00`. Gửi lại vẫn `00`, vẫn đúng 1 khoản hoàn.
- **Sửa lỗi kết quả thất bại của lần trả cũ đến muộn:** `applyResult` chỉ đổi trạng thái đơn khi chính khoản đó vừa chuyển sang `failed`. Trước đây, nếu callback thất bại của lần cũ tới đúng lúc khách đang tạo lần trả mới, đơn bị kéo về `pending` trong khi lần mới còn chạy; lần mới trả thành công sẽ thành khoản hoàn thay vì chốt đơn.
- **Return URL:** `isSuccess` giờ chỉ `true` khi khoản đã `succeeded` và đơn đã `paid`. Trước đây tiền về muộn vẫn báo thành công dù đơn đã hết hạn. Không đổi hợp đồng API.
- Không có migration.

## Chưa làm
- Hoàn tiền tự động qua VNPay và `querydr` (ngoài phạm vi TF30).
- Chưa có màn hình cho người xử lý: khoản hoàn VNPay chỉ được đánh dấu `needs_review` trong database.
- Chưa thử IPN thật từ VNPay báo thành công muộn; đã kiểm bằng test trên Postgres thật, với callback tự ký.
- Chưa sửa: nhập OTP sau khi job đã nhả chỗ trả 404, nên là 410.

## Đối chiếu "Xong khi"
| Tiêu chí (theo kế hoạch TF30) | Đạt | Bằng chứng |
|---|---|---|
| Mỗi ca ở bảng trên, chạy job 2 lần không trả chỗ 2 lần | Đạt | `expire-holds.int.spec.ts`: 6 test đầu. Có người khác cùng giữ để `greatest(0, …)` không che lỗi trả chỗ 2 lần |
| Trả tiền sau khi hết hạn, 2 bản job chạy cùng lúc | Đạt | `hai job tranh với trả tiền sau hạn chỉ nhả một lần và không trừ tiền`, `hai job cùng xử lý tám đơn quá hạn không nhả quá số chỗ` |
| 20 người tranh 5 chỗ, không bán trùng | Đạt | `20 người tranh 5 chỗ, ba người trả tiền, hai chỗ được bán lại` |
| VNPay báo thành công muộn cho lần đã bỏ ngang, có đúng 1 khoản hoàn | Đạt | `VNPay báo thành công sau khi job nhả chỗ tạo đúng một hoàn tiền`, `VNPay lần cũ báo thành công khi lần mới còn sống thì chỉ hoàn lần cũ`, `hai lần VNPay bỏ ngang có hai hoàn tiền riêng` |

## Kết quả kiểm tra
- `pnpm turbo run lint typecheck test --filter=@tripflix/core-api`: 13/13 task pass; lint 0 lỗi, 61 cảnh báo, không có cảnh báo nào trong module `commerce`; **core-api 305/305 test pass**.
- `pnpm --filter @tripflix/core-api test:int` (Postgres thật, Testcontainers): **66/66 pass**, trong đó TF30 có 18 test.
- `node tools/check-boundaries.mjs`: không vi phạm.
- `pnpm contracts:build`: `contracts/` không thay đổi.

### Thử làm hỏng code để kiểm tra test
Cố tình làm hỏng code từng kiểu rồi chạy `expire-holds.int.spec.ts`. Lần đầu 5/12 kiểu lọt (các số 3, 4, 5, 6, 10 dưới đây) nên đã thêm test; giờ **12/12 kiểu đều làm test đỏ**.

| # | Kiểu làm hỏng | Số test đỏ |
|---|---|---|
| 1 | Job chờ khoá đơn thay vì SKIP LOCKED | 4 |
| 2 | Job chờ khoá khoản trừ thay vì SKIP LOCKED | 1 |
| 3 | Job không xét lại trạng thái đơn sau khi khoá | 2 |
| 4 | Job nhả cả thẻ `initiated` | 1 |
| 5 | Danh sách không lọc cổng | 1 |
| 6 | Bỏ cửa sổ 15 phút VNPay | 1 |
| 7 | Khoá hoàn theo đơn thay vì theo khoản trừ | 3 |
| 8 | IPN bỏ qua tiền về muộn (lỗi gốc) | 3 |
| 9 | Tiền về muộn chuyển khoản sang `succeeded` | 3 |
| 10 | Không chuyển người xử lý trong TX2 | 1 |
| 11 | Return vẫn báo thành công khi tiền về muộn | 1 |
| 12 | Nhả ô không theo thứ tự | 1 |

## Cách kiểm lại
1. `pnpm --filter @tripflix/core-api test` (có unit test lịch chạy của job).
2. `pnpm --filter @tripflix/core-api exec vitest run --config vitest.int.config.ts src/modules/commerce/expire-holds.int.spec.ts` (cần Docker).

### Thử tay trên server thật (05/11, `node dist/main.js`, `APP_ROLE=all`, Postgres và Redis tạm, dữ liệu seed)
| Bước | Kết quả |
|---|---|
| Đăng nhập `member@tripflix.local`, `POST /api/checkout` | 201 `pending`; `held` từ 0 lên 1 |
| Chỉnh `hold_expires_at` về quá khứ, chờ job theo lịch (không gọi tay) | Sau 59 giây đơn `expired`, lý do "Hết thời gian giữ chỗ"; `held` về 0 |
| Log server | `Nhả chỗ quá hạn {"context":"ExpireHoldsJob","expired":1,"skipped":0,"errors":0}` |
| `GET /api/checkout/:id` | 200 `expired` |
| `PUT /api/checkout/:id/guests` sau hạn | 410 |
| Chờ thêm 1 chu kỳ job | Đơn vẫn `expired`, `held` vẫn 0 |

## Ảnh / video
- Không đổi giao diện.

## Ảnh hưởng tới phần của người khác
- Không. Mọi file nằm trong module `commerce`. Không đổi API, sự kiện hay schema database.
- Web / app: `GET /api/payments/vnpay/return` giờ trả `isSuccess: false` khi tiền về muộn, kể cả khi VNPay báo thành công.
