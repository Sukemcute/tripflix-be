import { Inject, Injectable, Logger } from '@nestjs/common';
import type { EventEnvelope } from '@tripflix/contracts';
import type { Kind, RawRow } from '../domain/contracts.js';
import { toOrderCancellation, toRawRows } from '../domain/ingest/to-raw-rows.js';
import { RECENT_POSTS_STORE, RECOMMEND_STORE, type RecentPostsStore, type RecommendStore } from './ports.js';

/** Tương tác rõ ý với bài thì vào gu trong phiên. */
const SESSION_KINDS = new Set<Kind>(['reaction', 'bookmark', 'comment', 'share']);

/** Nạp sự kiện vào bảng thô của gợi ý. Lỗi DB thì ném để consumer không XACK; payload hỏng thì log rồi bỏ. */
@Injectable()
export class RecommendIngestUseCases {
  private readonly logger = new Logger(RecommendIngestUseCases.name);

  constructor(
    @Inject(RECOMMEND_STORE) private readonly store: RecommendStore,
    @Inject(RECENT_POSTS_STORE) private readonly recent: RecentPostsStore,
  ) {}

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
    if (!rows.length) return;
    await this.store.upsertInteractions(rows, { source: event.type, eventId: event.eventId });
    await this.recordRecent(rows);
  }

  /** Redis lỗi chỉ log: bảng thô đã ghi, job 10 phút vẫn tính đủ, không cần giao lại sự kiện. */
  private async recordRecent(rows: RawRow[]): Promise<void> {
    const byUser = new Map<string, { add: Array<{ postId: string; at: number }>; remove: string[] }>();
    for (const r of rows) {
      if (r.actorType !== 'user' || r.targetType !== 'post' || !r.targetId || !SESSION_KINDS.has(r.kind)) continue;
      const change = byUser.get(r.actorId) ?? { add: [], remove: [] };
      if (r.isRemoved) change.remove.push(r.targetId);
      else change.add.push({ postId: r.targetId, at: Date.parse(r.occurredAt) });
      byUser.set(r.actorId, change);
    }
    for (const [userId, change] of byUser) {
      try {
        await this.recent.record(userId, change);
      } catch (err) {
        this.logger.warn({ err }, 'Ghi bài vừa tương tác lỗi (Redis), bỏ gu trong phiên lượt này');
      }
    }
  }
}
