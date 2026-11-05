# libs/auth

Kiểm access token của module `access` (JWT ES256) và chặn theo vai trò, dùng chung cho mọi app NestJS (docs/architecture/10 §3.10).

- Phụ trách: Dũng (backup Duy)
- Có thêm: token service-to-service (`@ServiceOnly`), access cấp qua `POST /api/auth/service-token`.

## Dùng trong app

```ts
import { AuthModule, RedisSidBlocklist, createAccessTokenVerifier } from '@tripflix/auth';
import { createRemoteJWKSet } from 'jose';

AuthModule.forRootAsync({
  inject: [ENV, REDIS],
  useFactory: (env: Env, redis: Redis) => ({
    verifier: createAccessTokenVerifier({
      keys: createRemoteJWKSet(new URL(env.JWKS_URL)), // http://core-api:3000/.well-known/jwks.json
      issuer: env.AUTH_JWT_ISSUER,
      audience: env.AUTH_JWT_AUDIENCE,
    }),
    blocklist: new RedisSidBlocklist(redis),
  }),
});
```

```ts
@Controller('admin/staff')
@Roles('superadmin')            // chưa đăng nhập: 401; sai vai trò: 403
export class StaffController {
  @Get()
  list(@CurrentUser() user: AuthUser) {}
}

@Get('me')
@Authenticated()                // chỉ cần đăng nhập
me(@CurrentUser() user: AuthUser) {}
```

## Kiểm những gì

| Kiểm | Lỗi |
|---|---|
| Header `Authorization: Bearer <token>` | 401 |
| Chữ ký ES256 theo JWKS, `kid` khớp | 401 |
| `iss`, `aud`, `exp`; đủ claim `sub`, `role`, `sid`, `iat` | 401 |
| `sid` không nằm trong danh sách chặn (Redis `auth:revoked-sid:<sid>`, ghi khi đăng xuất hoặc phát hiện dùng lại refresh token) | 401 |
| `role` nằm trong `@Roles(...)` | 403 |

`MemorySidBlocklist` dùng cho test.

## Token service

Service có API nội bộ cho service khác gọi: truyền `serviceVerifier` với `audience` là tên chính service đó.

```ts
AuthModule.forRootAsync({
  inject: [ENV, REDIS],
  useFactory: (env: Env, redis: Redis) => {
    const keys = createRemoteJWKSet(new URL(env.JWKS_URL));
    return {
      verifier: createAccessTokenVerifier({ keys, issuer: env.AUTH_JWT_ISSUER, audience: env.AUTH_JWT_AUDIENCE }),
      blocklist: new RedisSidBlocklist(redis),
      serviceVerifier: createServiceTokenVerifier({ keys, issuer: env.AUTH_JWT_ISSUER, audience: 'notification-service' }),
    };
  },
});

@Post('internal/notify')
@ServiceOnly('ai-service')           // bỏ trống: mọi service có token cho aud này
notify(@CurrentService() caller: ServiceCaller) {}
```

| Kiểm | Lỗi |
|---|---|
| Header `Authorization: Bearer <token>` | 401 |
| Chữ ký ES256, `iss`, `aud` = tên service này, `exp`; đủ `sub`, `typ`, `iat`; `typ` là `service` | 401 (token người dùng cũng 401 ở đây) |
| `sub` nằm trong `@ServiceOnly(...)` nếu có danh sách | 403 |

Chưa truyền `serviceVerifier` mà dùng `@ServiceOnly` thì guard ném lỗi cấu hình (500), để không lặng lẽ cho qua.
