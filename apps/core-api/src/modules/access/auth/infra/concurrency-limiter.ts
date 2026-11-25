import { SERVER_BUSY_MESSAGE } from '../domain/credentials.js';
import { AccessError } from '../domain/errors.js';

const RETRY_AFTER_SECONDS = 2;

/**
 * Cho tối đa `maxActive` việc chạy cùng lúc, `maxWaiting` việc xếp hàng; hàng đầy thì báo bận ngay (503)
 * thay vì để request chờ tới timeout.
 */
export class ConcurrencyLimiter {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(
    private readonly maxActive: number,
    private readonly maxWaiting: number,
  ) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active < this.maxActive) {
      this.active++;
    } else {
      if (this.waiting.length >= this.maxWaiting) throw new AccessError('server_busy', SERVER_BUSY_MESSAGE, RETRY_AFTER_SECONDS);
      // Việc xong trước trao thẳng chỗ của nó cho việc đang chờ, nên không tăng `active` ở đây.
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    try {
      return await task();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active--;
    }
  }
}
