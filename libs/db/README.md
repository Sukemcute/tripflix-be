# libs/db

Pool Postgres và Drizzle theo module, và transaction theo module bằng `@Transactional('<module>')` (docs/architecture/11 §3.3).

- Phụ trách: Dũng (backup Duy)

## Mỗi module một kết nối

| Module | Database | User Postgres | Pool |
|---|---|---|---|
| `access` | `core` | `tf_access` | 5 |
| `content` | `core` | `tf_content` | 10 |
| `discovery` | `core` | `tf_discovery` | 5 |
| `analytics` | `core` | `tf_analytics` | 3 |
| `commerce` | `commerce` | `tf_commerce` | 10 |

User của module chỉ có quyền trên schema của mình, nên query chéo schema lỗi ngay. `apps/core-api/src/platform/platform.module.ts` tạo pool, instance Drizzle (`buildDrizzleToken(module)`) và đăng ký `ClsModule` với `createTransactionalPlugins()`.

## `@Transactional('<module>')`

Use case trong `application/` đánh dấu transaction thuộc module nào; repository lấy transaction đang mở qua `TransactionHost`, không phải truyền `tx`:

```ts
// application/
@Injectable()
export class CompleteUploadUseCase {
  constructor(private readonly media: MediaRepository) {}

  @Transactional('content')
  async execute(mediaId: string) {
    await this.media.markUploaded(mediaId);
    // ghi outbox cũng nằm trong transaction này
  }
}

// infra/
@Injectable()
export class MediaRepository {
  constructor(@InjectTransactionHost('content') private readonly txHost: ModuleTransactionHost) {}

  markUploaded(mediaId: string) {
    return this.txHost.tx.update(mediaAssets).set({ status: 'uploaded' }).where(eq(mediaAssets.id, mediaId));
  }
}
```

- `txHost.tx` là transaction đang mở của module; ngoài hàm có `@Transactional` thì là kết nối thường.
- Hàm ném lỗi thì rollback.
- `@Transactional('content')` không mở transaction trên kết nối của `commerce`, nên không thể vô tình ghi chéo module trong một transaction.
- Không gọi dịch vụ ngoài (thanh toán, AI, S3, gửi thông báo) bên trong hàm có decorator (RULES §10).
- Test không có database: đăng ký `ClsPluginTransactional` với `NoOpTransactionalAdapter` của `@nestjs-cls/transactional`, hoặc Drizzle giả có hàm `transaction(fn)` (xem `src/transactional.spec.ts`).
