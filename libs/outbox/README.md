# libs/outbox

Ghi sự kiện vào bảng `outbox_events` **trong cùng transaction** với thay đổi nghiệp vụ, rồi relay gửi sang Redis Streams qua `@tripflix/event-bus` (docs/architecture/10 §3.3). Thay đổi rollback thì sự kiện cũng không đi.

- Phụ trách: Dũng (backup Duy)
- Chưa có: `@Transactional` (đang truyền `tx` tay), dead-letter khi gửi lỗi nhiều lần, job dọn dòng đã gửi.

## Dùng trong module (ví dụ `content`)

**1. Khai báo bảng** trong `db/schema` của module, rồi `pnpm db:generate content`:

```ts
// apps/core-api/src/modules/content/db/schema/outbox.ts
import { createOutboxTable } from '@tripflix/outbox';
import { contentSchema } from './content-schema.js';

export const contentOutboxEvents = createOutboxTable(contentSchema); // bảng content.outbox_events
```

**2. Ghi sự kiện** bằng `tx` của transaction đang mở:

```ts
import { addOutboxEvent } from '@tripflix/outbox';

await db.transaction(async (tx) => {
  await tx.update(mediaAssets).set({ status: 'uploaded' }).where(eq(mediaAssets.id, mediaId));
  await addOutboxEvent(
    tx,
    contentOutboxEvents,
    { type: 'media.transcode_requested', userId: ownerId, payload: { mediaId, sourceKey } },
    'core-api/content',
  );
});
```

- `type` dạng `<nguồn>.<đối tượng>.<việc>`, chữ thường (kiểm bằng `eventEnvelopeSchema` của `libs/contracts`). Sai thì ném `InvalidOutboxEventError`.
- Payload nên có schema trong `libs/contracts` (ví dụ `AccessUserRegisteredV1Schema`) rồi chạy `pnpm contracts:build`.
- Sự kiện mang sẵn dữ liệu consumer cần (docs/10 §3.5), không đưa email hay dữ liệu cá nhân không cần thiết.

**3. Bật relay** khi `APP_ROLE` là `worker` hoặc `all`. Xem mẫu `apps/core-api/src/modules/access/auth/infra/access-outbox-relay.ts`:

```ts
new OutboxRelay({
  store: new DrizzleOutboxStore(createDb(pools.content), contentOutboxEvents),
  bus: new RedisStreamsEventBus(redis),
  stream: STREAMS.content,
  onError: (err, envelope) => logger.error({ err, eventId: envelope?.eventId }, 'Gửi sự kiện lỗi'),
}).start();
```

## Relay làm gì

| Bước | Cách làm |
|---|---|
| Giành lô | `UPDATE … SET locked_until = now() + 30s WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED LIMIT 100)`, commit ngay. Nhiều replica không giành trùng |
| Gửi | `XADD` từng sự kiện theo thứ tự `occurred_at`, **ngoài** transaction database |
| Thành công | Ghi `published_at` |
| Lỗi | Tăng `attempts`, ghi `last_error`, giữ khoá; dừng lô. Hết khoá (30 giây) thì gửi lại |
| Giữ thứ tự | Không giành sự kiện xảy ra sau một sự kiện chưa gửi đang bị khoá, nên sự kiện mới không vượt lên trước sự kiện đang lỗi |

Giao **ít nhất một lần**: relay có thể gửi lại một sự kiện (ví dụ chết sau `XADD` trước khi ghi `published_at`), nên consumer phải loại trùng theo `eventId`. Thứ tự giữ được khi một relay chạy; nhiều replica chạy cùng lúc thì hiếm khi có thể lệch, consumer không được dựa vào thứ tự tuyệt đối.

## Test

`MemoryOutboxStore` cùng quy tắc giành khoá với bản Drizzle, dùng để test relay hoặc use case mà không cần database.
