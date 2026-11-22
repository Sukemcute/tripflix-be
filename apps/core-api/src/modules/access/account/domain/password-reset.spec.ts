import { MemoryActionRateLimiter } from '../../auth/infra/memory/memory-action-rate-limiter.js';
import { buildResetUrl } from './password-reset.js';

describe('buildResetUrl', () => {
  it('thêm ?token=, mã hoá ký tự đặc biệt, giữ query sẵn có của trang', () => {
    expect(buildResetUrl('http://localhost:3100/dat-lai-mat-khau', 'abc_-123')).toBe(
      'http://localhost:3100/dat-lai-mat-khau?token=abc_-123',
    );
    expect(buildResetUrl('https://tripflix.vn/reset?lang=vi', 'a+b/c')).toBe('https://tripflix.vn/reset?lang=vi&token=a%2Bb%2Fc');
  });
});

describe('MemoryActionRateLimiter', () => {
  it('chặn khi vượt limit trong cửa sổ, mở lại khi hết cửa sổ, đếm riêng từng key', async () => {
    let now = 0;
    const limiter = new MemoryActionRateLimiter(() => now);
    for (let i = 0; i < 3; i += 1) expect((await limiter.consume('a', 3, 60)).isBlocked).toBe(false);
    expect(await limiter.consume('a', 3, 60)).toEqual({ isBlocked: true, retryAfterSeconds: 60 });
    expect((await limiter.consume('b', 3, 60)).isBlocked).toBe(false);
    now = 60_000;
    expect((await limiter.consume('a', 3, 60)).isBlocked).toBe(false);
  });
});
