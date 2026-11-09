// Public API duy nhất của module access. Module khác chỉ được import từ file này.
export { AccessModule } from './access.module.js';
export { AccessFacade } from './access.facade.js';

// Dùng trong E2E của module khác cần đăng nhập thật mà không có database:
// overrideProvider(ACCESS_STORE).useValue(new MemoryAccessStore()), tương tự cho LOGIN_RATE_LIMITER, ACCESS_SID_BLOCKLIST.
export {
  ACCESS_SID_BLOCKLIST,
  ACCESS_STORE,
  ACTION_RATE_LIMITER,
  CLOCK,
  LOGIN_RATE_LIMITER,
  PASSWORD_HASHER,
  type AccessStore,
  type Clock,
  type LoginRateLimiter,
  type PasswordHasher,
} from './auth/application/ports.js';
export { MemoryAccessStore } from './auth/infra/memory/memory-access.store.js';
export { MemoryLoginRateLimiter } from './auth/infra/memory/memory-login-rate-limiter.js';
export { registerServiceClient } from './service/application/service-token.use-cases.js';
export { MemoryActionRateLimiter } from './auth/infra/memory/memory-action-rate-limiter.js';
