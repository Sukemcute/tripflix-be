import { Logger, Module } from '@nestjs/common';
import { AuthModule, RedisSidBlocklist, createAccessTokenVerifier, type SidBlocklist } from '@tripflix/auth';
import { buildTransactionHostToken, type ModuleTransactionHost } from '@tripflix/db';
import type { Redis } from 'ioredis';
import { createLocalJWKSet } from 'jose';
import type { CoreEnv } from '../../platform/env.js';
import { CORE_ENV, REDIS } from '../../platform/tokens.js';
import { AuthController } from './auth/api/auth.controller.js';
import { JwksController } from './auth/api/jwks.controller.js';
import { AuthUseCases } from './auth/application/auth.use-cases.js';
import {
  ACCESS_SID_BLOCKLIST,
  ACCESS_STORE,
  CLOCK,
  LOGIN_RATE_LIMITER,
  PASSWORD_HASHER,
  TOKEN_ISSUER,
  type Clock,
  type TokenIssuer,
} from './auth/application/ports.js';
import { AccessOutboxRelay } from './auth/infra/access-outbox-relay.js';
import { Argon2PasswordHasher } from './auth/infra/argon2-password-hasher.js';
import { DrizzleAccessStore } from './auth/infra/drizzle-access.store.js';
import { JoseTokenIssuer } from './auth/infra/jose-token-issuer.js';
import { RedisLoginRateLimiter } from './auth/infra/redis-login-rate-limiter.js';
import { AdminController } from './staff/api/admin.controller.js';
import { StaffUseCases } from './staff/application/staff.use-cases.js';

/** Hạ tầng của access: database (user tf_access), Redis, khoá ký. Test thay bằng overrideProvider. */
@Module({
  providers: [
    { provide: CLOCK, useValue: (() => new Date()) satisfies Clock },
    {
      provide: ACCESS_STORE,
      inject: [buildTransactionHostToken('access')],
      // txHost.tx: transaction đang mở của @Transactional('access'), hoặc kết nối thường của tf_access.
      useFactory: (txHost: ModuleTransactionHost) => new DrizzleAccessStore(() => txHost.tx),
    },
    { provide: PASSWORD_HASHER, useClass: Argon2PasswordHasher },
    { provide: LOGIN_RATE_LIMITER, inject: [REDIS], useFactory: (redis: Redis) => new RedisLoginRateLimiter(redis) },
    { provide: ACCESS_SID_BLOCKLIST, inject: [REDIS], useFactory: (redis: Redis): SidBlocklist => new RedisSidBlocklist(redis) },
    {
      provide: TOKEN_ISSUER,
      inject: [CORE_ENV, CLOCK],
      useFactory: async (env: CoreEnv, clock: Clock): Promise<TokenIssuer> => {
        const { issuer, isEphemeral } = await JoseTokenIssuer.create(
          {
            privateKeyPem: env.AUTH_JWT_PRIVATE_KEY,
            kid: env.AUTH_JWT_KID,
            issuer: env.AUTH_JWT_ISSUER,
            audience: env.AUTH_JWT_AUDIENCE,
          },
          clock,
        );
        if (isEphemeral) {
          new Logger('AccessModule').warn(
            'Chưa đặt AUTH_JWT_PRIVATE_KEY: dùng khoá tạm, token mất hiệu lực khi core-api khởi động lại',
          );
        }
        return issuer;
      },
    },
  ],
  exports: [CLOCK, ACCESS_STORE, PASSWORD_HASHER, LOGIN_RATE_LIMITER, ACCESS_SID_BLOCKLIST, TOKEN_ISSUER],
})
export class AccessInfraModule {}

/**
 * Module access. Chủ: Dũng (backup Duy). Xem README.md cùng thư mục.
 * Module khác chỉ dùng những gì được export trong index.ts; guard @Roles lấy từ @tripflix/auth.
 */
@Module({
  imports: [
    AccessInfraModule,
    // core-api tự kiểm token bằng khoá công khai của chính nó, không gọi HTTP tới /.well-known/jwks.json.
    AuthModule.forRootAsync({
      imports: [AccessInfraModule],
      inject: [TOKEN_ISSUER, ACCESS_SID_BLOCKLIST, CORE_ENV],
      useFactory: (tokens: TokenIssuer, blocklist: SidBlocklist, env: CoreEnv) => ({
        verifier: createAccessTokenVerifier({
          keys: createLocalJWKSet(tokens.getJwks()),
          issuer: env.AUTH_JWT_ISSUER,
          audience: env.AUTH_JWT_AUDIENCE,
        }),
        blocklist,
      }),
    }),
  ],
  controllers: [AuthController, JwksController, AdminController],
  providers: [AuthUseCases, StaffUseCases, AccessOutboxRelay],
})
export class AccessModule {}
