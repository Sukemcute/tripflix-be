/**
 * Giới hạn số lượt chạy cùng lúc theo từng khoá (một phòng + ngày) trong một tiến trình; lượt vượt giới hạn xếp hàng
 * trong bộ nhớ, không giữ kết nối database. Chờ quá hạn, hoặc hàng đã quá dài, thì báo bận để client thử lại.
 * Dùng cho giữ chỗ: mỗi lượt giữ một kết nối trong lúc chờ khoá dòng, không giới hạn thì một phòng bị tranh chiếm hết
 * pool commerce và cả hệ thống lỗi theo (đo sự cố TF29). Phòng còn nhiều chỗ thì lượt xếp hàng chỉ chờ vài chục ms.
 */
export class CellGate {
  private readonly running = new Map<string, number>();
  private readonly waiters: { keys: string[]; wake: () => void }[] = [];

  constructor(private readonly options: { maxPerKey: number; maxWaiting: number; waitMs: number }) {}

  /** true: đã vào, nhớ gọi release(keys). false: hết thời gian chờ hoặc hàng quá dài. */
  async acquire(keys: string[]): Promise<boolean> {
    if (this.canEnter(keys)) {
      this.enter(keys);
      return true;
    }
    if (this.waiters.length >= this.options.maxWaiting) return false;
    return new Promise<boolean>((resolve) => {
      const waiter = {
        keys,
        wake: () => {
          clearTimeout(timer);
          this.enter(keys);
          resolve(true);
        },
      };
      const timer = setTimeout(() => {
        this.waiters.splice(this.waiters.indexOf(waiter), 1);
        resolve(false);
      }, this.options.waitMs);
      this.waiters.push(waiter);
    });
  }

  release(keys: string[]): void {
    for (const key of keys) {
      const left = (this.running.get(key) ?? 1) - 1;
      if (left > 0) this.running.set(key, left);
      else this.running.delete(key);
    }
    // Người chờ trước vào trước, nếu khoá của họ đã có chỗ.
    for (let i = 0; i < this.waiters.length; ) {
      const waiter = this.waiters[i]!;
      if (this.canEnter(waiter.keys)) {
        this.waiters.splice(i, 1);
        waiter.wake();
      } else i++;
    }
  }

  private canEnter(keys: string[]): boolean {
    return keys.every((key) => (this.running.get(key) ?? 0) < this.options.maxPerKey);
  }

  private enter(keys: string[]): void {
    for (const key of keys) this.running.set(key, (this.running.get(key) ?? 0) + 1);
  }
}
