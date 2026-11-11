/**
 * Cache trong bộ nhớ có hạn sống và giới hạn số mục, dùng cho các lệnh đọc nóng (trang tìm khách sạn).
 * Lưu luôn promise đang chạy để nhiều request cùng khoá chỉ đi database một lần (tránh dồn tải khi cache vừa hết hạn).
 * Lệnh lỗi không được giữ lại, lần gọi sau thử lại ngay.
 */
export class TtlCache<T> {
  private readonly entries = new Map<string, { expiresAt: number; value: Promise<T> }>();

  constructor(
    private readonly options: { ttlMs: number; maxEntries: number; now?: () => number },
  ) {}

  get(key: string, load: () => Promise<T>): Promise<T> {
    const now = this.options.now?.() ?? Date.now();
    const hit = this.entries.get(key);
    if (hit && hit.expiresAt > now) return hit.value;
    if (hit) this.entries.delete(key);

    const value = load();
    this.entries.set(key, { expiresAt: now + this.options.ttlMs, value });
    value.catch(() => {
      if (this.entries.get(key)?.value === value) this.entries.delete(key);
    });
    // Map giữ thứ tự thêm vào: vượt giới hạn thì bỏ mục cũ nhất để bộ nhớ không phình theo số kiểu tìm.
    while (this.entries.size > this.options.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    return value;
  }

  get size(): number {
    return this.entries.size;
  }
}
