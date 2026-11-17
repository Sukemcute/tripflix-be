# TF95 — Ghi và báo cáo chi phí AI ở module analytics

- Notion: TF95 · Nhánh: `bao/TF95-analytics-ai-usage` · Người làm: Bảo (dùng AI: có) · Ngày: 2026-11-17
- Kế hoạch Tripi: bước B3. Nguồn sự kiện: tripflix-ai `app/services/usage_events.py` (đã có từ TF95 phía AI). Bên dùng: trang admin chi phí AI (B11).

## Đã làm
- **Bảng `analytics.ai_usage_events`:** mỗi lần ai-service gọi LLM hoặc kiểm duyệt là một dòng.
  - Cột: `id` (= eventId, khoá chính), `occurred_at`, `feature`, `step`, `model`, `input_tokens`, `output_tokens`, `cost_usd`, `is_estimated`, `created_at`.
  - Index `idx_ai_usage_events_occurred_at`.
  - **Không lưu `userId`:** báo cáo chi phí không cần biết ai gọi.
  - Migration sinh bằng `pnpm db:generate analytics --name init_ai_usage`. Dòng `CREATE SCHEMA` đổi thành `IF NOT EXISTS` như migration đầu của các module khác, vì `deploy/postgres/init` đã tạo schema.
- **Consumer `AiUsageConsumer`:** group `core-analytics` trên `stream:ai`, chỉ chạy khi `APP_ROLE` là worker hoặc all.
  - Ghi theo eventId (`ON CONFLICT DO NOTHING`): sự kiện giao lại không đếm trùng.
  - Payload sai hợp đồng: ghi log rồi bỏ qua, vì thử lại cũng không sửa được.
  - Lỗi database: ném để Redis giao lại; quá 5 lần thì thư viện chuyển sang `stream:dead-letter`.
- **`GET /api/analytics/ai-usage?from=&to=&groupBy=feature|day|model`:** chỉ superadmin.
  - Ngày theo giờ Việt Nam, gồm cả `from` và `to`. Mặc định 7 ngày tới hôm nay, tối đa 92 ngày.
  - Trả `{ from, to, groupBy, rows: [{ key, calls, inputTokens, outputTokens, costUsd }], total }`.
  - Thêm `model` vào `groupBy` (kế hoạch chỉ có feature, day) để so chi phí DeepSeek với OpenAI.
- `pnpm contracts:build`: `contracts/openapi/core-api.json` chỉ thêm (+161 dòng, 0 dòng xoá).
- **Khác README của analytics:** README dự kiến bảng `events` chung, chia partition theo ngày. Em làm bảng riêng cho chi phí AI để không phải dựng cả phần ingest. Phần ingest chung là việc của chị Trang.

## Đối chiếu "Xong khi"
| Tiêu chí (kế hoạch B3) | Đạt | Bằng chứng |
|---|---|---|
| Bảng `analytics.ai_usage_events`, chống trùng theo eventId | Đạt | `db/schema/index.ts`, migration `20261117015323_init_ai_usage`; test "sự kiện giao lại không đếm trùng" |
| Consumer `stream:ai`, group `core-analytics`, chỉ chạy ở worker | Đạt | `ai-usage.consumer.ts`; test payload sai bỏ qua, lỗi DB ném |
| `GET /api/analytics/ai-usage` chỉ superadmin | Đạt | `@Roles('superadmin')` trên controller; test query (ngày giờ VN, mặc định, giới hạn) |
| Đẩy sự kiện thật vào `stream:ai`, thấy dòng trong bảng, phát lại không đếm trùng | **Chưa** | Docker trên máy tắt; xem "Cách kiểm lại" |

## Kết quả kiểm tra
- `pnpm turbo run lint typecheck test --affected`: **49/49** task thành công (2026-11-17).
  - core-api: 2.591 test pass, 4 skip (có sẵn từ trước); `ai-usage.spec.ts` 10/10.
  - Lint: 0 lỗi, 0 cảnh báo ở file mới.

## Cách kiểm lại
1. `pnpm stack:up` rồi `pnpm db:migrate`: thấy `analytics: đã migrate`.
2. Chạy ai-service rồi chat vài câu với Tripi (mỗi câu phát 1–2 sự kiện `ai.usage.recorded`).
   - Hoặc đẩy tay:
     ```bash
     redis-cli XADD stream:ai '*' event '{"eventId":"0b9c3f0e-8a63-4d0f-9d58-3c1f2b7a1e01","type":"ai.usage.recorded","version":1,"occurredAt":"2026-11-17T01:02:03Z","producer":"ai-service","payload":{"feature":"chat","step":"controller","model":"gpt-5-nano","inputTokens":1200,"outputTokens":80,"costUsd":0.000092,"estimated":true}}'
     ```
3. `psql` vào database core: `SELECT feature, model, cost_usd FROM analytics.ai_usage_events;` có dòng vừa đẩy. Đẩy lại đúng lệnh đó, số dòng không tăng.
4. Đăng nhập superadmin, gọi `GET /api/analytics/ai-usage?groupBy=model`: thấy `calls`, token, `costUsd` theo model. Tài khoản thường gọi thì 403.

## Ảnh / video
- Không đổi giao diện.

## Ảnh hưởng tới phần của người khác
- Có: module `analytics` (chủ: **chị Trang**, backup Thành).
  - Module đang trống. Em thêm phần con `ai-usage/` (api, application, domain, infra, consumers), bảng đầu tiên và migration đầu tiên.
  - Sửa `analytics.module.ts` để đăng ký controller, consumer, store.
  - **Lưu ý cho chị Trang:** khi làm phần ingest nghe mọi stream bằng group `core-analytics`, cần gộp consumer này vào đó. Hai consumer cùng group trên `stream:ai` sẽ chia nhau sự kiện. Đã ghi chú trong code.
  - Cần chị Trang duyệt trước khi merge.
- `libs/event-bus` (chủ: Dũng): không sửa. Hàm khởi động lại consumer chép từ `DiscoveryEventsConsumer`, đánh dấu `shortcut:` để sau gom vào thư viện.
