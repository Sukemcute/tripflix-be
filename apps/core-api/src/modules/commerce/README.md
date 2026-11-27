# Module `commerce`

- Chủ: Thắng (backup Bảo)
- Database: `core`, schema `commerce`, user Postgres `tf_commerce`
- Bảng chính dự kiến: `properties`, `room_types`, `room_inventory`, `room_rates`, `flights`, `flight_inventory`, `orders`, `order_items`, `payments`, `refunds`

## Phần con

- inventory: khách sạn, loại phòng, chuyến bay, giá và lịch trống theo ngày; job mở lịch 180 ngày, 6 giờ/lần
- booking: đơn, giữ chỗ 30 phút, job hết hạn mỗi phút
- payment: cổng giả lập, đối soát, hoàn huỷ

Schema `commerce` trong database `core` (từ 05/11, trước đó là database riêng). User `tf_commerce` chỉ có quyền trên schema này, module khác không đọc được bảng của commerce; module khác gọi qua `CommerceModule` export trong `index.ts`.

## Khuôn thư mục

Mỗi phần con (`inventory/`, `booking/`, `payment/`) chia:

```
<phần-con>/
├─ api/           # controller, DTO; không mở transaction
├─ application/   # use case, @Transactional('commerce'), ghi outbox
├─ domain/        # quy tắc nghiệp vụ thuần, không import @nestjs/* hay drizzle-orm
├─ infra/         # repository Drizzle, client dịch vụ ngoài
├─ consumers/     # nghe sự kiện (chỉ chạy khi APP_ROLE là worker hoặc all)
└─ jobs/          # job định kỳ (như trên)
```

Bảng khai báo trong `db/schema/`. Sinh migration: `pnpm db:generate commerce`. Không sửa migration đã merge.

## Bộ cấp suất HTTP

Mỗi tiến trình dùng chung một `AdmissionGate` trong `platform/` để giới hạn lượt đang xử lý:

- `browse`: mọi GET khách sạn và chuyến bay, tối đa `TOTAL - TX_RESERVED` lượt và không vượt tổng `TOTAL`. Hết suất hoặc có giao dịch chờ thì từ chối ngay, không xếp hàng.
- `transaction`: toàn bộ checkout (kể cả GET chuyến đi của tôi), thanh toán/huỷ VNPay và cổng giả lập. Được mượn mọi suất trống tới `TOTAL`; khi đầy thì xếp hàng FIFO có giới hạn và thời hạn. Mỗi suất vừa trả ưu tiên người đang chờ trước lượt mới.
- `exempt`: callback VNPay (`ipn`, `return`) và admin đơn/lịch/metrics luôn đi qua, không chiếm suất. Callback cần xử lý cả khi đông khách vì VNPay có thể đã trừ tiền.

Lượt bị từ chối nhận HTTP 503, header `Retry-After: 2` và body `{statusCode:503, code:'BUSY_TRY_AGAIN', message:'Đang đông khách, bạn thử lại sau ít giây.'}`. Suất được trả đúng một lần khi observable hoàn tất hoặc lỗi, kể cả checkout ném `HttpException` 202.

Biến môi trường được commerce đọc và kiểm tra riêng, không cần sửa cấu hình platform:

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `COMMERCE_ADMIT_ENABLED` | `true` | `false` thì bỏ qua gate, không đếm lượt |
| `COMMERCE_ADMIT_TOTAL` | `80` | Tổng suất hai làn mỗi tiến trình, số nguyên dương |
| `COMMERCE_ADMIT_TX_RESERVED` | `20` | Suất dành riêng cho giao dịch, từ 0 và nhỏ hơn `TOTAL` |
| `COMMERCE_ADMIT_TX_QUEUE_MAX` | `50` | Số giao dịch chờ tối đa; 0 thì không xếp hàng |
| `COMMERCE_ADMIT_TX_WAIT_MS` | `2000` | Thời gian chờ tối đa (ms); 0 thì từ chối ngay khi đầy |

`GET /api/admin/commerce/metrics` có thêm `instances[].admission` và `totals.admission`, công bố qua Redis mỗi 5 giây như số pool. `browseInFlight`, `txInFlight`, `txWaiting` là số hiện tại; `browseRejected`, `txRejected`, `txQueuedTotal` tích luỹ suốt vòng đời tiến trình. `txWaitMsMax` là thời gian chờ lớn nhất đã kết thúc (được vào hoặc hết hạn); tổng lấy giá trị lớn nhất giữa các tiến trình. Những trường metrics cũ vẫn giữ nguyên.
