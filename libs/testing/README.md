# libs/testing

Bật Postgres và Redis **thật** trong Docker (Testcontainers) cho test cần database: tranh chỗ cuối, xoay vòng token, outbox, idempotency.

- Phụ trách: Dũng
- Chưa có: factory dữ liệu dùng chung (thêm khi có module cần).

## Chạy

```sh
pnpm test:int          # mọi package có *.int.spec.ts, lần lượt từng package (cần Docker Desktop đang chạy)
pnpm --filter @tripflix/testing test:int
```

`pnpm test` không chạy các file `*.int.spec.ts`, nên không cần Docker. CI chạy cả hai.

## Dùng trong test

```ts
import { migrateModule, startPostgres, startRedis, type PostgresFixture } from '@tripflix/testing';

let postgres: PostgresFixture;
beforeAll(async () => {
  postgres = await startPostgres(); // chạy deploy/postgres/init/*.sql: 3 database, user tf_<module>, schema, extension
  await migrateModule({
    url: postgres.buildModuleUrl('commerce'),
    module: 'commerce',
    migrationsFolder: fileURLToPath(new URL('../db/migrations', import.meta.url)),
  });
});
afterAll(() => postgres.stop());
```

| Hàm | Trả về |
|---|---|
| `startPostgres()` | `buildModuleUrl(module)`: kết nối bằng `tf_<module>`, chỉ có quyền trên schema của module. `buildAdminUrl(db)`: superuser, chỉ để chuẩn bị hoặc kiểm dữ liệu |
| `startRedis()` | `url` |
| `migrateModule({ url, module, migrationsFolder })` | Chạy migration như `pnpm db:migrate` |

Image giống `deploy/compose.yaml` (`pgvector/pgvector:pg17`, `redis:8.8-alpine`), nên máy đã chạy `pnpm stack:infra` không phải tải thêm.

## Thêm test DB thật vào một package

1. Đặt tên file `*.int.spec.ts`.
2. Thêm `vitest.int.config.ts` (chép từ `libs/testing`) và script `"test:int": "vitest run --config vitest.int.config.ts"`.
3. Trong `vitest.config.ts` thêm `exclude: ['src/**/*.int.spec.ts']`.
