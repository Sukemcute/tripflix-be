import type { EventEnvelope } from '@tripflix/contracts';
import type { EventBus, StreamName } from '@tripflix/event-bus';
import type { OutboxStore } from './store.js';

export interface OutboxRelayOptions {
  store: OutboxStore;
  bus: EventBus;
  /**
   * Stream của module phát, ví dụ STREAMS.content. Bảng outbox có sự kiện đi nhiều stream thì truyền hàm chọn.
   * Mỗi sự kiện đi đúng một stream. Hàm ném lỗi (type lạ) được xử lý như gửi lỗi, không có stream mặc định.
   */
  stream: StreamName | ((envelope: EventEnvelope) => StreamName);
  batchSize?: number;
  /** Nghỉ giữa hai vòng khi không còn sự kiện chờ. */
  intervalMs?: number;
  lockSeconds?: number;
  /** Báo lỗi ra logger của app; relay không tự ghi log. */
  onError?: (error: unknown, envelope?: EventEnvelope) => void;
}

export interface RelayRoundResult {
  publishedCount: number;
  failedCount: number;
}

/**
 * Đọc outbox rồi XADD sang Redis Streams. Giao ít nhất một lần: consumer phải loại trùng theo eventId.
 * Chạy ở core-api khi APP_ROLE là worker hoặc all. Không gửi Redis trong transaction database:
 * giành dòng bằng locked_until (commit ngay), gửi, rồi mới đánh dấu đã gửi.
 */
export class OutboxRelay {
  private timer: NodeJS.Timeout | undefined;
  private isRunning = false;
  private currentRound: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: OutboxRelayOptions) {}

  /**
   * Một vòng: giành lô, gửi theo thứ tự. Lỗi ở một sự kiện thì dừng lô; sự kiện đó và các sự kiện phía sau
   * giữ khoá tới khi hết lockSeconds rồi được gửi lại cùng thứ tự.
   */
  async publishPending(): Promise<RelayRoundResult> {
    const { store, bus, stream, batchSize = 100, lockSeconds = 30, onError } = this.options;
    const claimed = await store.claimBatch(batchSize, lockSeconds);
    let publishedCount = 0;
    for (const { envelope } of claimed) {
      try {
        const targetStream = typeof stream === 'function' ? stream(envelope) : stream;
        await bus.publish(targetStream, envelope);
      } catch (err) {
        onError?.(err, envelope);
        await store.markFailed(envelope.eventId, err instanceof Error ? err.message : String(err));
        return { publishedCount, failedCount: 1 };
      }
      await store.markPublished(envelope.eventId);
      publishedCount += 1;
    }
    return { publishedCount, failedCount: 0 };
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.scheduleNextRound(0);
  }

  /** Dừng vòng lặp và chờ vòng đang chạy xong. */
  async stop(): Promise<void> {
    this.isRunning = false;
    if (this.timer) clearTimeout(this.timer);
    await this.currentRound;
  }

  private scheduleNextRound(delayMs: number): void {
    this.timer = setTimeout(() => {
      this.currentRound = this.publishPending()
        .then(({ publishedCount, failedCount }) => {
          if (!this.isRunning) return;
          // Lỗi: nghỉ hết thời gian khoá (Redis sập thì không gọi dồn). Đầy lô: chạy tiếp ngay. Còn lại: nghỉ intervalMs.
          if (failedCount > 0) return this.scheduleNextRound((this.options.lockSeconds ?? 30) * 1000);
          const hasMore = publishedCount === (this.options.batchSize ?? 100);
          this.scheduleNextRound(hasMore ? 0 : (this.options.intervalMs ?? 500));
        })
        .catch((err: unknown) => {
          this.options.onError?.(err);
          if (this.isRunning) this.scheduleNextRound(this.options.intervalMs ?? 500);
        });
    }, delayMs);
  }
}
