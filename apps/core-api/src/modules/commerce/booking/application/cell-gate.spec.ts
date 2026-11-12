import { CellGate } from './cell-gate.js';

describe('CellGate', () => {
  it('khoá khác nhau không chặn nhau, khoá đủ lượt thì chờ', async () => {
    const gate = new CellGate({ maxPerKey: 1, maxWaiting: 10, waitMs: 1_000 });
    expect(await gate.acquire(['a'])).toBe(true);
    expect(await gate.acquire(['b'])).toBe(true);
    const waiting = gate.acquire(['a']);
    gate.release(['a']);
    expect(await waiting).toBe(true);
  });

  it('hàng chờ đầy thì từ chối ngay', async () => {
    const gate = new CellGate({ maxPerKey: 1, maxWaiting: 1, waitMs: 1_000 });
    await gate.acquire(['a']);
    const first = gate.acquire(['a']);
    expect(await gate.acquire(['a'])).toBe(false);
    gate.release(['a']);
    expect(await first).toBe(true);
  });

  it('giỏ nhiều phòng chỉ vào khi mọi khoá đều còn lượt', async () => {
    vi.useFakeTimers();
    try {
      const gate = new CellGate({ maxPerKey: 1, maxWaiting: 10, waitMs: 500 });
      await gate.acquire(['b']);
      const both = gate.acquire(['a', 'b']);
      await vi.advanceTimersByTimeAsync(500);
      expect(await both).toBe(false);
      // Lượt hết hạn không chiếm chỗ của khoá a.
      expect(await gate.acquire(['a'])).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
