import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdmissionGate, type AdmissionGateOptions } from './admission-gate.js';

function createGate(overrides: Partial<AdmissionGateOptions> = {}): AdmissionGate {
  return new AdmissionGate({ total: 4, txReserved: 1, txQueueMax: 3, txWaitMs: 100, ...overrides });
}

describe('AdmissionGate', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    try {
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('giới hạn lượt xem ở TOTAL - TX_RESERVED và giữ nguyên số đang chạy khi từ chối', () => {
    const gate = createGate({ total: 5, txReserved: 2 });

    expect([gate.tryBrowse(), gate.tryBrowse(), gate.tryBrowse(), gate.tryBrowse()]).toEqual([true, true, true, false]);
    expect(gate.snapshot()).toEqual({ browseInFlight: 3, txInFlight: 0, txWaiting: 0, browseRejected: 1, txRejected: 0, txQueuedTotal: 0, txWaitMsMax: 0 });
  });

  it('từ chối lượt xem khi tổng đầy dù còn dưới giới hạn của lượt xem', async () => {
    const gate = createGate();
    expect(gate.tryBrowse()).toBe(true);
    await expect(Promise.all([gate.acquireTx(), gate.acquireTx(), gate.acquireTx()])).resolves.toEqual([true, true, true]);

    expect(gate.tryBrowse()).toBe(false);
    expect(gate.snapshot()).toMatchObject({ browseInFlight: 1, txInFlight: 3, browseRejected: 1 });
  });

  it('cho giao dịch mượn toàn bộ TOTAL khi không có lượt xem rồi mới xếp hàng', async () => {
    const gate = createGate();
    await expect(Promise.all([gate.acquireTx(), gate.acquireTx(), gate.acquireTx(), gate.acquireTx()])).resolves.toEqual([true, true, true, true]);
    const waiting = gate.acquireTx();

    expect(gate.snapshot()).toMatchObject({ browseInFlight: 0, txInFlight: 4, txWaiting: 1, txQueuedTotal: 1 });
    gate.release('transaction');
    await expect(waiting).resolves.toBe(true);
    expect(gate.snapshot()).toMatchObject({ txInFlight: 4, txWaiting: 0 });
  });

  it('giữ đủ suất dành riêng cho giao dịch khi lượt xem đã chạm trần', async () => {
    const gate = createGate({ total: 5, txReserved: 2 });
    expect([gate.tryBrowse(), gate.tryBrowse(), gate.tryBrowse()]).toEqual([true, true, true]);

    await expect(Promise.all([gate.acquireTx(), gate.acquireTx()])).resolves.toEqual([true, true]);
    expect(gate.snapshot()).toMatchObject({ browseInFlight: 3, txInFlight: 2, txWaiting: 0, txRejected: 0 });
  });

  it('chuyển ngay mọi suất vừa trả theo FIFO trước lượt xem hoặc giao dịch mới', async () => {
    const gate = createGate();
    const admissionOrder: string[] = [];
    expect(gate.tryBrowse()).toBe(true);
    await Promise.all([gate.acquireTx(), gate.acquireTx(), gate.acquireTx()]);
    const first = gate.acquireTx().then((isAdmitted) => { admissionOrder.push('first'); return isAdmitted; });
    const second = gate.acquireTx().then((isAdmitted) => { admissionOrder.push('second'); return isAdmitted; });
    expect(gate.snapshot().txWaiting).toBe(2);
    expect(gate.tryBrowse()).toBe(false);

    gate.release('browse');
    expect(gate.snapshot()).toMatchObject({ browseInFlight: 0, txInFlight: 4, txWaiting: 1 });
    expect(gate.tryBrowse()).toBe(false);
    const third = gate.acquireTx().then((isAdmitted) => { admissionOrder.push('third'); return isAdmitted; });
    expect(gate.snapshot().txWaiting).toBe(2);
    await expect(first).resolves.toBe(true);
    expect(admissionOrder).toEqual(['first']);

    gate.release('transaction');
    expect(gate.snapshot()).toMatchObject({ txInFlight: 4, txWaiting: 1 });
    expect(gate.tryBrowse()).toBe(false);
    await expect(second).resolves.toBe(true);
    expect(admissionOrder).toEqual(['first', 'second']);

    gate.release('transaction');
    expect(gate.snapshot()).toMatchObject({ txInFlight: 4, txWaiting: 0 });
    await expect(third).resolves.toBe(true);
    expect(admissionOrder).toEqual(['first', 'second', 'third']);
    gate.release('transaction');
    expect(gate.tryBrowse()).toBe(true);
    expect(gate.snapshot()).toMatchObject({ browseInFlight: 1, txInFlight: 3, txWaiting: 0 });
  });

  it('từ chối khi hàng chờ đầy mà không tăng tổng số giao dịch đã xếp hàng', async () => {
    const gate = createGate({ total: 1, txReserved: 0, txQueueMax: 2 });
    await expect(gate.acquireTx()).resolves.toBe(true);
    const first = gate.acquireTx();
    const second = gate.acquireTx();

    await expect(gate.acquireTx()).resolves.toBe(false);
    expect(gate.snapshot()).toMatchObject({ txInFlight: 1, txWaiting: 2, txRejected: 1, txQueuedTotal: 2 });
    gate.release('transaction');
    await expect(first).resolves.toBe(true);
    gate.release('transaction');
    await expect(second).resolves.toBe(true);
  });

  it('hết giờ chỉ xoá đúng người chờ đó và giao suất tiếp theo cho người còn lại', async () => {
    const gate = createGate({ total: 1, txReserved: 0 });
    await gate.acquireTx();
    const first = gate.acquireTx();
    await vi.advanceTimersByTimeAsync(40);
    const settleSecond = vi.fn((isAdmitted: boolean) => isAdmitted);
    const second = gate.acquireTx().then(settleSecond);
    await vi.advanceTimersByTimeAsync(60);

    await expect(first).resolves.toBe(false);
    expect(settleSecond).not.toHaveBeenCalled();
    expect(gate.snapshot()).toMatchObject({ txInFlight: 1, txWaiting: 1, txRejected: 1, txQueuedTotal: 2, txWaitMsMax: 100 });
    gate.release('transaction');
    await expect(second).resolves.toBe(true);
    const afterRelease = gate.snapshot();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(settleSecond).toHaveBeenCalledExactlyOnceWith(true);
    expect(gate.snapshot()).toEqual(afterRelease);
    gate.release('transaction');
    expect(gate.tryBrowse()).toBe(true);
    expect(gate.snapshot()).toMatchObject({ browseInFlight: 1, txInFlight: 0, txWaiting: 0 });
  });

  it('huỷ timer của người đã nhận suất để không đụng người chờ kế tiếp', async () => {
    const gate = createGate({ total: 1, txReserved: 0 });
    await gate.acquireTx();
    const first = gate.acquireTx();
    await vi.advanceTimersByTimeAsync(20);
    gate.release('transaction');
    await expect(first).resolves.toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    const second = gate.acquireTx();
    await vi.advanceTimersByTimeAsync(80);

    expect(vi.getTimerCount()).toBe(1);
    expect(gate.snapshot()).toMatchObject({ txInFlight: 1, txWaiting: 1, txRejected: 0, txWaitMsMax: 20 });
    gate.release('transaction');
    await expect(second).resolves.toBe(true);
    expect(gate.snapshot()).toMatchObject({ txInFlight: 1, txWaiting: 0, txRejected: 0, txWaitMsMax: 80 });
    const afterRelease = gate.snapshot();
    await vi.advanceTimersByTimeAsync(200);
    expect(gate.snapshot()).toEqual(afterRelease);
  });

  it.each([100, 110])('bỏ người đã hết hạn khi timer bị trễ và chuyển suất đúng FIFO ở %i ms', async (releaseAtMs) => {
    vi.setSystemTime(0);
    const gate = createGate({ total: 1, txReserved: 0 });
    await gate.acquireTx();
    const expired = gate.acquireTx();
    await vi.advanceTimersByTimeAsync(40);
    const admissionOrder: string[] = [];
    const second = gate.acquireTx().then((isAdmitted) => { admissionOrder.push('second'); return isAdmitted; });
    const third = gate.acquireTx().then((isAdmitted) => { admissionOrder.push('third'); return isAdmitted; });
    vi.setSystemTime(releaseAtMs);

    gate.release('transaction');
    expect(gate.snapshot()).toMatchObject({ txInFlight: 1, txWaiting: 1, txRejected: 1, txQueuedTotal: 3, txWaitMsMax: releaseAtMs });
    await expect(expired).resolves.toBe(false);
    await expect(second).resolves.toBe(true);
    expect(admissionOrder).toEqual(['second']);
    gate.release('transaction');
    await expect(third).resolves.toBe(true);
    expect(admissionOrder).toEqual(['second', 'third']);
  });

  it('bỏ mọi người chờ đã hết hạn trước khi cho lượt xem dùng suất vừa trống', async () => {
    vi.setSystemTime(0);
    const gate = createGate({ total: 3 });
    await Promise.all([gate.acquireTx(), gate.acquireTx(), gate.acquireTx()]);
    const first = gate.acquireTx();
    const second = gate.acquireTx();
    vi.setSystemTime(101);

    gate.release('transaction');
    await expect(Promise.all([first, second])).resolves.toEqual([false, false]);
    expect(gate.snapshot()).toMatchObject({ browseInFlight: 0, txInFlight: 2, txWaiting: 0, txRejected: 2, txQueuedTotal: 2, txWaitMsMax: 101 });
    expect(gate.tryBrowse()).toBe(true);
    expect(gate.snapshot()).toMatchObject({ browseInFlight: 1, txInFlight: 2, txWaiting: 0 });
  });

  it('bỏ qua trả suất lặp lại khi lane đã rỗng và không làm giảm lane khác', async () => {
    const gate = createGate({ total: 2 });
    gate.release('browse');
    gate.release('transaction');
    expect(gate.tryBrowse()).toBe(true);
    await expect(gate.acquireTx()).resolves.toBe(true);

    gate.release('browse');
    gate.release('browse');
    expect(gate.snapshot()).toMatchObject({ browseInFlight: 0, txInFlight: 1 });
    gate.release('transaction');
    gate.release('transaction');
    expect(gate.snapshot()).toEqual({ browseInFlight: 0, txInFlight: 0, txWaiting: 0, browseRejected: 0, txRejected: 0, txQueuedTotal: 0, txWaitMsMax: 0 });
  });

  it('trả suất của lane rỗng không đánh thức người chờ khi lane khác còn đầy', async () => {
    const gate = createGate({ total: 1, txReserved: 0 });
    await gate.acquireTx();
    const waiting = gate.acquireTx();

    gate.release('browse');
    gate.release('browse');
    expect(gate.snapshot()).toMatchObject({ browseInFlight: 0, txInFlight: 1, txWaiting: 1 });
    gate.release('transaction');
    await expect(waiting).resolves.toBe(true);
  });

  it('giữ gauges hiện tại, bộ đếm tích luỹ và thời gian chờ lớn nhất qua nhiều snapshot', async () => {
    const gate = createGate({ total: 2, txReserved: 1, txQueueMax: 1 });
    expect(gate.tryBrowse()).toBe(true);
    expect(gate.tryBrowse()).toBe(false);
    await gate.acquireTx();
    const first = gate.acquireTx();
    await expect(gate.acquireTx()).resolves.toBe(false);
    expect(gate.snapshot()).toMatchObject({ browseInFlight: 1, txInFlight: 1, txWaiting: 1, browseRejected: 1, txRejected: 1, txQueuedTotal: 1 });
    await vi.advanceTimersByTimeAsync(40);
    gate.release('browse');
    await expect(first).resolves.toBe(true);
    expect(gate.snapshot().txWaitMsMax).toBe(40);
    const timedOut = gate.acquireTx();
    await vi.advanceTimersByTimeAsync(100);
    await expect(timedOut).resolves.toBe(false);

    const expected = { browseInFlight: 0, txInFlight: 2, txWaiting: 0, browseRejected: 1, txRejected: 2, txQueuedTotal: 2, txWaitMsMax: 100 };
    expect(gate.snapshot()).toEqual(expected);
    expect(gate.snapshot()).toEqual(expected);
    const snapshot = gate.snapshot();
    snapshot.txInFlight = 999;
    snapshot.txRejected = 999;
    expect(gate.snapshot()).toEqual(expected);
  });

  it.each([
    { txQueueMax: 0, txWaitMs: 100 },
    { txQueueMax: 3, txWaitMs: 0 },
  ])('từ chối ngay khi không cho xếp hàng hoặc không cho đợi: %j', async (limits) => {
    const gate = createGate({ total: 1, txReserved: 0, ...limits });
    await expect(gate.acquireTx()).resolves.toBe(true);

    await expect(gate.acquireTx()).resolves.toBe(false);
    expect(gate.snapshot()).toMatchObject({ txInFlight: 1, txWaiting: 0, txRejected: 1, txQueuedTotal: 0, txWaitMsMax: 0 });
  });
});
