import { Inject, Injectable, Logger } from '@nestjs/common';
import type { EventEnvelope } from '@tripflix/contracts';
import { toOrderCancellation, toRawRows } from '../domain/ingest/to-raw-rows.js';
import { RECOMMEND_STORE, type RecommendStore } from './ports.js';

/** Nạp sự kiện vào bảng thô của gợi ý. Lỗi DB thì ném để consumer không XACK; payload hỏng thì log rồi bỏ. */
@Injectable()
export class RecommendIngestUseCases {
  private readonly logger = new Logger(RecommendIngestUseCases.name);

  constructor(@Inject(RECOMMEND_STORE) private readonly store: RecommendStore) {}

  async ingest(event: EventEnvelope): Promise<void> {
    const cancellation = toOrderCancellation(event);
    if (cancellation) {
      await this.store.cancelOrderItems(cancellation);
      return;
    }
    const rows = cancellation === null ? null : toRawRows(event);
    if (rows === null) {
      // Thử lại cũng không sửa được payload hỏng.
      this.logger.warn({ eventId: event.eventId, type: event.type }, 'Payload sự kiện sai schema, bỏ qua cho gợi ý');
      return;
    }
    if (rows.length) await this.store.upsertInteractions(rows, { source: event.type, eventId: event.eventId });
  }
}
