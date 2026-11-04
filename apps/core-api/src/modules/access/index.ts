// Public API duy nhất của module access. Module khác chỉ được import từ file này.
export { AccessModule } from './access.module.js';

// Dùng trong E2E của module khác cần đăng nhập thật mà không có database:
// overrideProvider(ACCESS_STORE).useValue(new MemoryAccessStore()), tương tự cho LOGIN_RATE_LIMITER, ACCESS_SID_BLOCKLIST.
export { ACCESS_SID_BLOCKLIST, ACCESS_STORE, LOGIN_RATE_LIMITER } from './auth/application/ports.js';
export { MemoryAccessStore } from './auth/infra/memory/memory-access.store.js';
export { MemoryLoginRateLimiter } from './auth/infra/memory/memory-login-rate-limiter.js';
