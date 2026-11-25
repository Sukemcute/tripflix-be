import { AccessError } from '../domain/errors.js';
import { ConcurrencyLimiter } from './concurrency-limiter.js';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

describe('ConcurrencyLimiter', () => {
  it('chạy tối đa maxActive việc cùng lúc, việc sau chờ tới lượt', async () => {
    const limiter = new ConcurrencyLimiter(2, 10);
    let running = 0;
    let peak = 0;
    const gates = [deferred(), deferred(), deferred()];
    const tasks = gates.map((gate) =>
      limiter.run(async () => {
        peak = Math.max(peak, ++running);
        await gate.promise;
        running--;
      }),
    );
    await Promise.resolve();
    expect(running).toBe(2);
    gates.forEach((g) => g.resolve());
    await Promise.all(tasks);
    expect(peak).toBe(2);
  });

  it('hàng chờ đầy thì báo bận ngay (server_busy, Retry-After), không chạy việc', async () => {
    const limiter = new ConcurrencyLimiter(1, 1);
    const gate = deferred();
    const first = limiter.run(() => gate.promise);
    const second = limiter.run(async () => 'xong');
    const rejected = limiter.run(async () => 'không được chạy');
    await expect(rejected).rejects.toMatchObject({ code: 'server_busy', retryAfterSeconds: 2 });
    await expect(rejected).rejects.toBeInstanceOf(AccessError);
    gate.resolve();
    await first;
    expect(await second).toBe('xong');
  });

  it('việc lỗi vẫn trả chỗ cho việc sau', async () => {
    const limiter = new ConcurrencyLimiter(1, 0);
    await expect(limiter.run(async () => Promise.reject(new Error('hỏng')))).rejects.toThrow('hỏng');
    expect(await limiter.run(async () => 'tiếp')).toBe('tiếp');
  });
});
