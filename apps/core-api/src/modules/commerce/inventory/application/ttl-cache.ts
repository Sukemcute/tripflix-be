/**
 * Cache trong bộ nhớ có hạn sống và giới hạn số mục, dùng cho các lệnh đọc nóng (trang tìm, trang khách sạn).
 * Lưu luôn promise đang chạy để nhiều request cùng khoá chỉ đi database một lần (tránh dồn tải khi cache vừa hết hạn).
 * Lệnh lỗi không được giữ lại, lần gọi sau thử lại ngay.
 * Có `staleMs` và `canServeStale`: nguồn lỗi (database tắt, hết kết nối) mà còn kết quả tốt gần nhất chưa quá staleMs
 * thì trả kết quả đó thay vì báo lỗi; giữ nó thêm một hạn sống để không dội database đang hồi phục.
 */
export class TtlCache<T> {
  private readonly entries = new Map<string, { expiresAt: number; value: Promise<T> }>();
  private readonly lastGood = new Map<string, { value: T; at: number }>();

  constructor(
    private readonly options: {
      ttlMs: number;
      maxEntries: number;
      now?: () => number;
      staleMs?: number;
      canServeStale?: (error: unknown) => boolean;
    },
  ) {}

  get(key: string, load: () => Promise<T>): Promise<T> {
    const now = this.options.now?.() ?? Date.now();
    const hit = this.entries.get(key);
    if (hit && hit.expiresAt > now) return hit.value;
    if (hit) this.entries.delete(key);

    const value = load().then(
      (result) => {
        if (this.options.staleMs) this.remember(key, result, now);
        return result;
      },
      (error: unknown) => {
        const stale = this.lastGood.get(key);
        const isUsable = stale && this.options.staleMs && now - stale.at <= this.options.staleMs && (this.options.canServeStale?.(error) ?? false);
        if (isUsable) return stale.value;
        throw error;
      },
    );
    this.entries.set(key, { expiresAt: now + this.options.ttlMs, value });
    value.catch(() => {
      if (this.entries.get(key)?.value === value) this.entries.delete(key);
    });
    // Map giữ thứ tự thêm vào: vượt giới hạn thì bỏ mục cũ nhất để bộ nhớ không phình theo số kiểu tìm.
    trimOldest(this.entries, this.options.maxEntries);
    return value;
  }

  private remember(key: string, value: T, at: number) {
    this.lastGood.delete(key);
    this.lastGood.set(key, { value, at });
    trimOldest(this.lastGood, this.options.maxEntries);
  }

  get size(): number {
    return this.entries.size;
  }
}

function trimOldest(map: Map<string, unknown>, max: number) {
  while (map.size > max) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}
