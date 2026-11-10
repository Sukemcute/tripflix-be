# TF70 — Hoàn tiền VNPay tự động

- Notion: chưa cung cấp link task · Nhánh: `thang/TF70-huy-don-hoan-tien` · Người làm: Thắng (dùng AI: có) · Ngày: 2026-11-10

## Đã làm

- Giữ nguyên phần TF70 chưa commit: huỷ đơn đã trả, báo phí huỷ, controller/DTO, chính sách huỷ, contracts và kiểm thử sẵn có.
- Thêm bộ ký JSON Merchant API cho `refund`/`querydr`, kiểm HMAC-SHA512 theo thứ tự trường, dùng lại formatter giờ Việt Nam.
- Thêm `VnpayRefundClient` dùng fetch, timeout 15 giây, kiểm kiểu JSON, checksum và merchant/giao dịch/số tiền/loại hoàn trước khi ghi thành công.
- Định tuyến mock qua cổng hiện có; VNPay qua registry khi có cấu hình. Cổng chưa hỗ trợ hoặc thiếu cấu hình chuyển `needs_review`.
- Mở rộng bản ghi hoàn với mã, ngày tạo và số tiền của payment gốc. Không thêm dependency hoặc migration.
- Cả xử lý trực tiếp và job nhận lượt bằng `claimDueRefunds`, có backoff và khoá `FOR UPDATE SKIP LOCKED`; gọi mạng sau khi transaction kết thúc.
- Lưu `vnpay:submitted` vào `refunds.gateway_ref` bằng UPDATE có điều kiện trước khi gọi mạng. Chỉ một tác vụ nhận được quyền gửi, kể cả khi lease cũ hết hạn. Khi thành công, thay dấu này bằng mã hoàn thật của VNPay.
- Mã 94 lưu `vnpay:accepted`, vẫn `initiated`; các lần sau chỉ `querydr`. Mất mạng, checksum sai, mã 99 hoặc mất phản hồi cũng chỉ tra cứu sau lần gửi có thể đã tới VNPay. Không gửi thêm khi tra cứu vẫn trả giao dịch thanh toán cũ.
- Chỉ cho gửi lại sau phản hồi có chữ ký đúng, đúng merchant/giao dịch và xác nhận bị từ chối trước xử lý (02/03/97). Mã 91/95 chuyển review. Quá 30 lần chưa xác nhận được cũng chuyển review.
- Thêm `VNPAY_API_URL` và CLI theo mẫu `src/cli` có sẵn; CLI chạy vai trò API để không khởi động job nền.
- URL pay mới lấy `vnp_CreateDate` từ payment vừa lưu, nên ngày giao dịch gửi lúc hoàn khớp chính xác thay vì dựa vào hai lần đọc đồng hồ. Phản hồi huỷ đơn cũng phản ánh ngay `needs_review` nếu VNPay từ chối lần thử đầu.

## File bổ sung/thay đổi cho phần VNPay

- `apps/core-api/src/modules/commerce/payment/domain/vnpay-merchant-api.ts` và `.spec.ts`.
- `apps/core-api/src/modules/commerce/payment/infra/vnpay-refund-gateway.ts` và `.spec.ts`.
- `apps/core-api/src/modules/commerce/payment/application/refund-gateways.port.ts`, `payment.use-cases.ts`, `payment.use-cases.spec.ts`, `vnpay.use-cases.ts`, `vnpay.use-cases.spec.ts`.
- `apps/core-api/src/modules/commerce/booking/application/ports.ts`, `booking/infra/drizzle-order.store.ts`.
- `apps/core-api/src/modules/commerce/commerce.module.ts`, `expire-holds.int.spec.ts`.
- `apps/core-api/.env.example`, `apps/core-api/src/cli/vnpay-refund-check.ts` và file evidence này.

## Đối chiếu tiêu chí yêu cầu

| Tiêu chí từ yêu cầu TF70 | Đạt | Bằng chứng |
|---|---|---|
| Ký và kiểm checksum Merchant API đúng thứ tự | Có | 47 test domain; checksum được tính độc lập bằng `node:crypto` trong test |
| Hoàn VNPay được tự động định tuyến | Có | 24 test use case, gồm thành công, 94, 95, thiếu cấu hình và cổng mock |
| Client không tin phản hồi sai chữ ký hoặc sai giao dịch | Có | 50 test client, dùng fetch giả, không có mạng |
| Ngày giao dịch pay mới khớp ngày gửi refund | Có | 4 test use case VNPay, gồm ranh giới giây/ngày GMT+7 và đọc payment không thành công |
| Không gửi hoàn lần hai sau mất phản hồi, ghi DB lỗi, restart hoặc lease hết hạn | Có ở unit test | Marker lưu trước mạng, UPDATE có điều kiện; regression với querydr trả pay01 cũ |
| Không gọi cổng trong transaction | Có qua review | Các phương thức transaction chỉ ghi DB/nhận lượt; client được gọi từ `processRefunds`/`reconcile` |
| Integration trên Postgres thật | Chưa chạy được | 2 suite lỗi khởi tạo vì không có container runtime; 46 test không được thực thi |
| Sandbox VNPay thật | Chưa chạy | Không đọc `.env` hoặc dùng thông tin merchant thật trong phiên |

## Kết quả kiểm tra

Chạy tại `apps/core-api` bằng công cụ cục bộ có sẵn:

- `.\node_modules\.bin\vitest.CMD run --passWithNoTests`: **798 pass, 1 skipped có sẵn**; 65 file pass, 1 file skipped.
- `.\node_modules\.bin\tsc.CMD -p tsconfig.json --noEmit --incremental false`: **pass**, exit 0.
- `.\node_modules\.bin\tsc.CMD -p tsconfig.build.json`: **pass**, exit 0; bao gồm CLI mới trong `dist/cli`.
- `.\node_modules\.bin\oxlint.CMD --type-aware src`: **pass**, exit 0; 82 warning từ code có sẵn (gồm phần TF70 trước phiên), không có warning ở file mới.
- `.\node_modules\.bin\vitest.CMD run --config vitest.int.config.ts src/modules/commerce/checkout.int.spec.ts src/modules/commerce/expire-holds.int.spec.ts`: **không chạy được**; 2 suite lỗi `Could not find a working container runtime strategy`, 46 test không thực thi. Không thêm `skip` vào test.
- Tại repo: `node tools/check-boundaries.mjs`: **pass**, không vi phạm ranh giới module.
- Tại repo: `git diff --check`: **pass**.
- Lệnh chuẩn `pnpm turbo run lint typecheck test --affected` đã thử: PowerShell chặn `pnpm.ps1`; `pnpm.cmd` và gọi Turbo trực tiếp vẫn bị quyền truy cập pnpm store lock ngoài workspace (`ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK`). Vì vậy dùng các executable trong `node_modules/.bin` để kiểm core-api trực tiếp.

## Cách kiểm lại

1. Chạy lint, typecheck, build và unit test ở trên, hoặc `pnpm --filter @tripflix/core-api lint`, `typecheck`, `build`, `test` trên máy không bị giới hạn pnpm store.
2. Có Docker đang chạy: chạy hai integration suite ở trên.
3. Cấu hình merchant sandbox và `VNPAY_API_URL` theo `.env.example`; build core-api rồi chạy từ `apps/core-api`: `node dist/cli/vnpay-refund-check.js <orderId>`.
4. Kiểm tra mã hoàn, số tiền và trạng thái ở VNPay sandbox cùng bản ghi refund; chạy lại phải không sinh khoản hoàn mới. CLI chỉ xử lý khoản đang đến lịch; khoản đang backoff sẽ được job hỏi lại sau.

## Giới hạn cần kiểm thực tế

- `vnp_TransactionDate` được dựng từ `payments.created_at` theo yêu cầu. Pay flow mới dùng cùng mốc này cho `vnp_CreateDate`. Các payment tạo trước thay đổi có thể lệch khoảng một giây; chưa kiểm được VNPay sandbox chấp nhận mức lệch này không.
- Nếu chết sau khi lưu dấu submitted nhưng trước khi gửi, hoặc không xác minh được kết quả đã gửi, hệ thống ưu tiên không hoàn trùng: tiếp tục tra cứu rồi chuyển review sau MAX_CHECKS. Không tự suy luận pay01 là bằng chứng chắc chắn chưa hoàn.
- Khoản cũ đã có `needs_review=true` giữ nguyên để tránh gửi lại khoản có thể đã được xử lý thủ công; không tự mở lại backlog này.
- Chưa commit/push, tạo PR hoặc ghi Notion trong phiên này.

## Ảnh / video

- Không thay giao diện.

## Ảnh hưởng tới phần của người khác

- Trong commerce của Thắng và các file cấu hình/CLI/evidence được yêu cầu. Không sửa nguồn module khác, `libs/`, CI, Docker hoặc contracts có sẵn.
- Đã thử giao phần cơ học cho Codex CLI; sandbox chặn kết nối (`os error 10013`), nên các agent trong phiên hoàn tất domain/test và review. Agent chính giữ thiết kế, routing, persistence, client, cấu hình, CLI và kiểm tra tổng hợp.

## Thử thật trên VNPay sandbox (2026-11-10)
- Thanh toán: đơn 1 phòng 1.140.000đ, trả bằng thẻ test NCB qua `pay-vnpay`. VNPay trả `vnp_ResponseCode=00`, `vnp_TransactionStatus=00`; đơn chuyển `paid`, lưu `gateway_ref=15731239`, `gateway_bank_code=NCB`, `gateway_paid_at=2026-11-10 11:14:56 (GMT+7)`.
- Huỷ: `cancel-quote` trả hoàn 1.140.000đ, phí 0 (`free_cancel`); `cancel-paid` trả `refundStatus=processing`, khoản hoàn ở `initiated` để job đối soát thử lại.
- API Merchant của VNPay sandbox (`merchant_webapi/api/transaction`) trả `{"vnp_ResponseCode":"99","vnp_Message":"Unexpected error"}` cho mọi yêu cầu, kể cả khi cố tình gửi sai checksum hoặc sai `vnp_TmnCode`, nên lỗi nằm ở phía VNPay (API chưa mở cho mã website này hoặc sandbox lỗi), không phải ở chữ ký của Tripflix. Hệ thống xử lý đúng như thiết kế: `99` là thử lại, quá số lần thì chuyển người xử lý.
- Chưa xác nhận được nhánh hoàn thành công với VNPay thật; cần hỏi VNPay mở API hoàn tiền/truy vấn cho mã website sandbox.
