import { Logger, Module } from '@nestjs/common';
import {
  AuthModule,
  RedisSidBlocklist,
  createAccessTokenVerifier,
  createServiceTokenVerifier,
  type SidBlocklist,
} from '@tripflix/auth';
import { buildTransactionHostToken, type ModuleTransactionHost } from '@tripflix/db';
import type { Redis } from 'ioredis';
import { createLocalJWKSet, createRemoteJWKSet } from 'jose';
import { DEFAULT_GOOGLE_JWKS_URL } from '../../platform/env.js';
import type { CoreEnv } from '../../platform/env.js';
import { CORE_ENV, REDIS } from '../../platform/tokens.js';
import { AccountController } from './account/api/account.controller.js';
import { PasswordResetController } from './account/api/password-reset.controller.js';
import { UserSearchController } from './account/api/user-search.controller.js';
import { UserSearchUseCases } from './account/application/user-search.use-cases.js';
import { AccountUseCases } from './account/application/account.use-cases.js';
import { EmailVerificationController } from './account/api/email-verification.controller.js';
import { EmailVerificationUseCases } from './account/application/email-verification.use-cases.js';
import { PasswordResetUseCases } from './account/application/password-reset.use-cases.js';
import { AuthController } from './auth/api/auth.controller.js';
import { JwksController } from './auth/api/jwks.controller.js';
import { WebSession } from './auth/api/web-session.js';
import { AuthUseCases } from './auth/application/auth.use-cases.js';
import {
  ACCESS_SID_BLOCKLIST,
  ACCESS_STORE,
  ACTION_RATE_LIMITER,
  CLOCK,
  GOOGLE_VERIFIER,
  LOGIN_RATE_LIMITER,
  PASSWORD_HASHER,
  PASSWORD_KEYRING,
  TOKEN_ISSUER,
  type Clock,
  type GoogleIdTokenVerifier,
  type PasswordKeyring,
  type TokenIssuer,
} from './auth/application/ports.js';
import { PasswordEncryption } from './auth/application/password-encryption.js';
import { PasswordDecryptionInterceptor } from './auth/api/encrypted-passwords.js';
import { X25519PasswordKeyring } from './auth/infra/x25519-password-keyring.js';
import { AccessOutboxRelay } from './auth/infra/access-outbox-relay.js';
import { Argon2PasswordHasher } from './auth/infra/argon2-password-hasher.js';
import { DrizzleAccessStore } from './auth/infra/drizzle-access.store.js';
import { JoseGoogleIdTokenVerifier } from './auth/infra/jose-google-id-token-verifier.js';
import { JoseTokenIssuer } from './auth/infra/jose-token-issuer.js';
import { RedisActionRateLimiter } from './auth/infra/redis-action-rate-limiter.js';
import { RedisLoginRateLimiter } from './auth/infra/redis-login-rate-limiter.js';
import { AccessCleanupJob } from './auth/jobs/access-cleanup.job.js';
import { ServiceTokenController } from './service/api/service-token.controller.js';
import { ServiceTokenUseCases } from './service/application/service-token.use-cases.js';
import { CORE_API_SERVICE_AUDIENCE } from './service/domain/service-client-rules.js';
import { AccessFacade } from './access.facade.js';
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
    {
      provide: GOOGLE_VERIFIER,
      inject: [CORE_ENV],
      // JWKS của Google chỉ tải khi có người đăng nhập Google, jose tự cache và tải lại khi Google đổi khoá.
      // E2E cũ dựng env tay có thể thiếu hai biến này: dùng mặc định như khi parse env (đăng nhập Google tắt).
      useFactory: (env: CoreEnv): GoogleIdTokenVerifier =>
        new JoseGoogleIdTokenVerifier(
          createRemoteJWKSet(new URL((env.GOOGLE_JWKS_URL as string | undefined) ?? DEFAULT_GOOGLE_JWKS_URL)),
          (env.GOOGLE_CLIENT_IDS as string[] | undefined) ?? [],
        ),
    },
    { provide: LOGIN_RATE_LIMITER, inject: [REDIS], useFactory: (redis: Redis) => new RedisLoginRateLimiter(redis) },
    { provide: ACTION_RATE_LIMITER, inject: [REDIS], useFactory: (redis: Redis) => new RedisActionRateLimiter(redis) },
    { provide: ACCESS_SID_BLOCKLIST, inject: [REDIS], useFactory: (redis: Redis): SidBlocklist => new RedisSidBlocklist(redis) },
    {
      provide: PASSWORD_KEYRING,
      inject: [CORE_ENV],
      useFactory: (env: CoreEnv): PasswordKeyring | null => {
        const logger = new Logger('AccessModule');
        const keys = env.AUTH_PASSWORD_KEYS as string | undefined;
        if (keys) return X25519PasswordKeyring.fromConfig(keys);
        if (env.NODE_ENV === 'production') {
          logger.error('Chưa đặt AUTH_PASSWORD_KEYS: tắt mã hoá mật khẩu, client gửi mật khẩu như cũ (TF056)');
          return null;
        }
        // Dev, test: khoá tạm. Nhiều replica cần chung một khoá, nên production không dùng cách này.
        logger.warn('Chưa đặt AUTH_PASSWORD_KEYS: dùng khoá tạm để mã hoá mật khẩu, đổi mỗi lần core-api khởi động lại');
        return X25519PasswordKeyring.ephemeral();
      },
    },
    {
      provide: TOKEN_ISSUER,
      inject: [CORE_ENV, CLOCK],
      useFactory: async (env: CoreEnv, clock: Clock): Promise<TokenIssuer> => {
        const { issuer, isEphemeral } = await JoseTokenIssuer.create(
          {
            privateKeyPem: env.AUTH_JWT_PRIVATE_KEY,
            kid: env.AUTH_JWT_KID,
            previousKeys: env.AUTH_JWT_PREVIOUS_JWKS?.keys,
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
  exports: [
    CLOCK,
    ACCESS_STORE,
    PASSWORD_HASHER,
    LOGIN_RATE_LIMITER,
    ACTION_RATE_LIMITER,
    ACCESS_SID_BLOCKLIST,
    TOKEN_ISSUER,
    GOOGLE_VERIFIER,
    PASSWORD_KEYRING,
  ],
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
      useFactory: (tokens: TokenIssuer, blocklist: SidBlocklist, env: CoreEnv) => {
        const keys = createLocalJWKSet(tokens.getJwks());
        return {
          verifier: createAccessTokenVerifier({ keys, issuer: env.AUTH_JWT_ISSUER, audience: env.AUTH_JWT_AUDIENCE }),
          blocklist,
          // API nội bộ của core-api (@ServiceOnly) nhận token service có aud=core-api.
          serviceVerifier: createServiceTokenVerifier({ keys, issuer: env.AUTH_JWT_ISSUER, audience: CORE_API_SERVICE_AUDIENCE }),
        };
      },
    }),
  ],
  controllers: [
    AuthController,
    AccountController,
    PasswordResetController,
    EmailVerificationController,
    ServiceTokenController,
    JwksController,
    AdminController,
    UserSearchController,
  ],
  providers: [
    AuthUseCases,
    AccountUseCases,
    PasswordResetUseCases,
    EmailVerificationUseCases,
    StaffUseCases,
    UserSearchUseCases,
    ServiceTokenUseCases,
    PasswordEncryption,
    PasswordDecryptionInterceptor,
    WebSession,
    AccessOutboxRelay,
    AccessCleanupJob,
    AccessFacade,
  ],
  exports: [AccessFacade],
})
export class AccessModule {}
