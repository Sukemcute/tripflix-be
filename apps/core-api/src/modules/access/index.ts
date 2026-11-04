// Public API duy nhất của module access. Module khác chỉ được import từ file này.
export { AccessModule } from './access.module.js';
export {
  ACCESS_SID_BLOCKLIST,
  ACCESS_STORE,
  LOGIN_RATE_LIMITER,
  type AccessStore,
  type LoginRateLimiter,
} from './auth/application/ports.js';
export { MemoryAccessStore } from './auth/infra/memory/memory-access.store.js';
export { MemoryLoginRateLimiter } from './auth/infra/memory/memory-login-rate-limiter.js';
