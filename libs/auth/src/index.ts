export {
  ACCESS_TOKEN_ALG,
  InvalidAccessTokenError,
  createAccessTokenVerifier,
  type AccessTokenVerifier,
  type AccessTokenVerifierOptions,
  type AuthUser,
} from './verifier.js';
export { MemorySidBlocklist, RedisSidBlocklist, buildRevokedSidKey, type SidBlocklist } from './revocation.js';
export {
  AUTH_VERIFIER,
  AccessTokenGuard,
  AllowWhenRevocationUnavailable,
  Authenticated,
  CurrentUser,
  EMAIL_UNVERIFIED_CODE,
  EMAIL_UNVERIFIED_MESSAGE,
  FORBIDDEN_MESSAGE,
  OptionalAuthGuard,
  OptionalAuthenticated,
  OptionalCurrentUser,
  RequireVerifiedEmail,
  Roles,
  RolesGuard,
  SID_BLOCKLIST,
  UNAUTHORIZED_MESSAGE,
  VerifiedEmailGuard,
} from './guards.js';
export { AuthModule, type AuthModuleAsyncOptions, type AuthModuleOptions } from './auth.module.js';
export {
  CurrentService,
  INVALID_SERVICE_TOKEN_MESSAGE,
  InvalidServiceTokenError,
  SERVICE_NOT_ALLOWED_MESSAGE,
  SERVICE_TOKEN_TTL_SECONDS,
  SERVICE_TOKEN_TYPE,
  SERVICE_VERIFIER,
  ServiceOnly,
  ServiceTokenGuard,
  createServiceTokenVerifier,
  type ServiceCaller,
  type ServiceTokenVerifier,
  type ServiceTokenVerifierOptions,
} from './service-token.js';
