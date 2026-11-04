# libs/auth

Kiểm access token của module `access` (JWT ES256) và chặn theo vai trò, dùng chung cho mọi app NestJS (docs/architecture/10 §3.10).

- Phụ trách: Dũng (backup Duy)
- Chưa có: token service-to-service.

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
