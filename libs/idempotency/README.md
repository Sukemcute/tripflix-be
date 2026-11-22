# libs/idempotency

Chống xử lý hai lần khi app gửi lại cùng một lệnh ghi (mất mạng, bấm hai lần): đọc header `Idempotency-Key`, lưu kết quả lần đầu để trả lại (docs/architecture/10 §3.4, RULES §10).

- Phụ trách: Dũng (backup Duy); module `commerce` (Thắng) dùng đầu tiên.

## Dùng trong module (ví dụ `commerce`)

**1. Khai báo bảng** trong `db/schema` của module, rồi `pnpm db:generate commerce`:

```ts
import { createIdempotencyKeysTable } from '@tripflix/idempotency';
export const commerceIdempotencyKeys = createIdempotencyKeysTable(commerceSchema); // commerce.idempotency_keys
```

**2. Đăng ký store** trên kết nối của module:

```ts
@Module({
  imports: [
    IdempotencyModule.forFeature({
      inject: [buildDrizzleToken('commerce')],
      useFactory: (db: Db) => new DrizzleIdempotencyStore(db, commerceIdempotencyKeys),
    }),
  ],
  controllers: [CheckoutController],
})
export class CommerceModule {}
```

**3. Gắn lên handler**:

```ts
@Post('checkout')
@Roles('member')     // đặt guard trước để scope có userId
@Idempotent()
checkout(@Body() body: CheckoutRequestDto) { ... }
```

App tạo key ngẫu nhiên (UUID) **một lần cho mỗi thao tác** của người dùng, và gửi lại đúng key đó khi thử lại.

## Hành vi

| Tình huống | Kết quả |
|---|---|
| Thiếu header `Idempotency-Key` | `400` |
| Lần đầu | Xử lý, lưu mã trạng thái và body (24 giờ) |
| Gửi lại sau khi đã xong | Trả đúng kết quả cũ, header `Idempotency-Replayed: true`, **không xử lý lại** |
| Gửi lại khi lần đầu chưa xong | `409`, client thử lại sau |
| Cùng key nhưng body khác | `422` (so bằng SHA-256 của body, không phụ thuộc thứ tự khoá) |
| Lần đầu lỗi (ném exception) | Xoá chỗ đã giữ; gửi lại cùng key thì xử lý lại |
| Quá 24 giờ | Coi như key mới |

Phạm vi của key: người dùng (`req.user.userId` từ `@tripflix/auth`) + method + đường dẫn, nên hai người dùng trùng key không ảnh hưởng nhau.

## Giới hạn

Lưu kết quả là một lệnh riêng **sau** khi handler xong, không nằm chung transaction với nghiệp vụ. Nếu tiến trình sập đúng giữa hai bước, lần gửi lại sẽ bị `409` cho tới khi hết 24 giờ hoặc chạy lại nghiệp vụ nếu dòng bị xoá. Vì vậy use case vẫn phải tự an toàn khi chạy lại: cập nhật tồn kho, trạng thái đơn bằng `UPDATE … WHERE` có điều kiện (docs/10 §3.4).

## Test

`MemoryIdempotencyStore` cùng quy tắc với bản Drizzle. Test với Postgres thật: `pnpm --filter @tripflix/idempotency test:int` (10 request cùng lúc cùng key thì chỉ 1 được xử lý).
