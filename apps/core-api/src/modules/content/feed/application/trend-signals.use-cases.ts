import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  ContentPostBookingClickedV1Schema,
  ContentPostViewedV1Schema,
  type EventEnvelope,
} from '@tripflix/contracts';
import {
  toBookingClickSignal,
  toViewSignal,
  TREND_SIGNAL_RETENTION_DAYS,
  type TrendSignal,
} from '../domain/trend-signal.js';
import { TREND_SIGNAL_STORE, type TrendSignalStore } from './ports.js';

/** Xoá theo lô để không khoá bảng lâu. */
export const TREND_SIGNAL_PURGE_BATCH = 5_000;

/**
 * Lưu tín hiệu Hot từ stream:app-events (TF111) và dọn tín hiệu hết hạn.
 * Không mở transaction: mỗi sự kiện ghi đúng một dòng, không có thay đổi nghiệp vụ hay outbox đi kèm.
 */
@Injectable()
export class TrendSignalsUseCases {
  private readonly logger = new Logger(TrendSignalsUseCases.name);

  constructor(@Inject(TREND_SIGNAL_STORE) private readonly store: TrendSignalStore) {}

  /**
   * Payload sai schema là lỗi vĩnh viễn: ghi log rồi bỏ, không ném lỗi để consumer không giao lại mãi.
   * Lỗi database thì ném ra để consumer giao lại; ghi trùng không sao vì bảng chỉ giữ một dòng mỗi người, loại, bài.
   */
  async recordEvent(event: EventEnvelope): Promise<void> {
    const signal = this.toSignal(event);
    if (signal) await this.store.record(signal);
  }

  /** Xoá tín hiệu cũ hơn TREND_SIGNAL_RETENTION_DAYS ngày; trả tổng số dòng đã xoá. */
  async purgeExpired(now = new Date()): Promise<number> {
    const before = new Date(now.getTime() - TREND_SIGNAL_RETENTION_DAYS * 86_400_000);
    let total = 0;
    for (let deleted = TREND_SIGNAL_PURGE_BATCH; deleted === TREND_SIGNAL_PURGE_BATCH; total += deleted) {
      deleted = await this.store.purgeOlderThan(before, TREND_SIGNAL_PURGE_BATCH);
    }
    return total;
  }

  private toSignal(event: EventEnvelope): TrendSignal | null {
    if (event.type === 'content.post.viewed') {
      const parsed = ContentPostViewedV1Schema.safeParse(event.payload);
      if (parsed.success) return toViewSignal(parsed.data, event.occurredAt);
    } else if (event.type === 'content.post.booking_clicked') {
      const parsed = ContentPostBookingClickedV1Schema.safeParse(event.payload);
      if (parsed.success) return toBookingClickSignal(parsed.data, event.occurredAt);
    } else {
      // stream:app-events còn sự kiện của module khác; bỏ qua để chúng được XACK.
      return null;
    }
    this.logger.warn({ eventId: event.eventId, type: event.type }, 'Payload tín hiệu Hot sai schema, bỏ qua');
    return null;
  }
}
