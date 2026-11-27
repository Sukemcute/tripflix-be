export type AdmittedLane = 'browse' | 'transaction';

export interface AdmissionGateOptions {
  total: number;
  txReserved: number;
  txQueueMax: number;
  txWaitMs: number;
}

export interface AdmissionSnapshot {
  browseInFlight: number;
  txInFlight: number;
  txWaiting: number;
  browseRejected: number;
  txRejected: number;
  txQueuedTotal: number;
  txWaitMsMax: number;
}

interface TransactionWaiter {
  expiresAt: number;
  settle: (isAdmitted: boolean) => void;
}

/** Giữ suất giao dịch trong từng tiến trình để lượt xem không chiếm hết khả năng phục vụ. */
export class AdmissionGate {
  private browseInFlight = 0;
  private txInFlight = 0;
  private browseRejected = 0;
  private txRejected = 0;
  private txQueuedTotal = 0;
  private txWaitMsMax = 0;
  private readonly waiters: TransactionWaiter[] = [];

  constructor(private readonly options: AdmissionGateOptions) {}

  tryBrowse(): boolean {
    if (this.waiters.length > 0 || this.browseInFlight >= this.options.total - this.options.txReserved || this.isFull()) {
      this.browseRejected++;
      return false;
    }
    this.browseInFlight++;
    return true;
  }

  async acquireTx(): Promise<boolean> {
    if (this.waiters.length === 0 && !this.isFull()) {
      this.txInFlight++;
      return true;
    }
    if (this.waiters.length >= this.options.txQueueMax || this.options.txWaitMs === 0) {
      this.txRejected++;
      return false;
    }
    this.txQueuedTotal++;
    const queuedAt = Date.now();
    return new Promise<boolean>((resolve) => {
      const waiter: TransactionWaiter = {
        expiresAt: queuedAt + this.options.txWaitMs,
        settle: (isAdmitted) => {
          clearTimeout(timer);
          this.txWaitMsMax = Math.max(this.txWaitMsMax, Date.now() - queuedAt);
          if (isAdmitted) this.txInFlight++;
          else this.txRejected++;
          resolve(isAdmitted);
        },
      };
      const timer = setTimeout(() => {
        const index = this.waiters.indexOf(waiter);
        if (index < 0) return;
        this.waiters.splice(index, 1);
        waiter.settle(false);
      }, this.options.txWaitMs);
      this.waiters.push(waiter);
    });
  }

  release(lane: AdmittedLane): void {
    if (lane === 'browse') {
      if (this.browseInFlight === 0) return;
      this.browseInFlight--;
    } else {
      if (this.txInFlight === 0) return;
      this.txInFlight--;
    }
    // Chuyển suất ngay trước khi đánh thức để lượt mới không chen hàng giao dịch.
    let waiter: TransactionWaiter | undefined;
    while ((waiter = this.waiters.shift())) {
      // Event loop bận có thể làm timer chạy muộn; quá hạn vẫn phải từ chối.
      const isAdmitted = Date.now() < waiter.expiresAt;
      waiter.settle(isAdmitted);
      if (isAdmitted) break;
    }
  }

  snapshot(): AdmissionSnapshot {
    return {
      browseInFlight: this.browseInFlight,
      txInFlight: this.txInFlight,
      txWaiting: this.waiters.length,
      browseRejected: this.browseRejected,
      txRejected: this.txRejected,
      txQueuedTotal: this.txQueuedTotal,
      txWaitMsMax: this.txWaitMsMax,
    };
  }

  private isFull(): boolean {
    return this.browseInFlight + this.txInFlight >= this.options.total;
  }
}
