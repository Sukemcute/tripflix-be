import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { EventEnvelope } from '@tripflix/contracts';
import type { Kind, RawRow } from '../domain/contracts.js';
import { toOrderCancellation, toRawRows } from '../domain/ingest/to-raw-rows.js';
import { APPEND_ONLY_DAILY_CAP, isAppendOnly } from '../domain/row-limits.js';
import { INGEST_QUOTA, RECENT_POSTS_STORE, RECOMMEND_STORE, type IngestQuota, type RecentPostsStore, type RecommendStore } from './ports.js';

const dayOf = (iso: string) => new Date(iso).toISOString().slice(0, 10);

/** Tương tác rõ ý với bài thì vào gu trong phiên. */
export const SESSION_KINDS = new Set<Kind>(['reaction', 'bookmark', 'comment', 'share']);

/** Nạp sự kiện vào bảng thô của gợi ý. Lỗi DB thì ném để consumer không XACK; payload hỏng thì log rồi bỏ. */
@Injectable()
export class RecommendIngestUseCases {
  private readonly logger = new Logger(RecommendIngestUseCases.name);

  constructor(
    @Inject(RECOMMEND_STORE) private readonly store: RecommendStore,
    @Inject(RECENT_POSTS_STORE) private readonly recent: RecentPostsStore,
    @Optional() @Inject(INGEST_QUOTA) private readonly quota?: IngestQuota,
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
    const kept = await this.withinQuota(rows);
    if (!kept.length) return;
    await this.store.upsertInteractions(kept, { source: event.type, eventId: event.eventId });
    await this.recordRecent(kept);
  }

  /**
   * Bỏ dòng chỉ-thêm (tìm, chia sẻ…) vượt APPEND_ONLY_DAILY_CAP mỗi người mỗi loại mỗi ngày: một bot hay stress test đã
   * đăng nhập không làm phình bảng thô. Redis lỗi thì nạp đủ (job dọn và trần lúc đọc vẫn chặn phía sau).
   */
  private async withinQuota(rows: RawRow[]): Promise<RawRow[]> {
    if (!this.quota) return rows;
    const groups = new Map<string, RawRow[]>();
    for (const r of rows) {
      if (r.actorType !== 'user' || !isAppendOnly(r.kind)) continue;
      const k = `${r.actorId}|${r.kind}|${dayOf(r.occurredAt)}`;
      const group = groups.get(k);
      if (group) group.push(r);
      else groups.set(k, [r]);
    }
    const dropped = new Set<RawRow>();
    for (const group of groups.values()) {
      const { actorId, kind, occurredAt } = group[0]!;
      let total: number;
      try {
        total = await this.quota.add(actorId, kind, dayOf(occurredAt), group.length);
      } catch (err) {
        this.logger.warn({ err }, 'Đếm hạn mức nạp lỗi (Redis), nạp không chặn lượt này');
        continue;
      }
      const before = total - group.length;
      const allowed = Math.max(0, APPEND_ONLY_DAILY_CAP - before);
      if (allowed >= group.length) continue;
      for (const r of group.slice(allowed)) dropped.add(r);
      // Chỉ báo lần đầu vượt trong ngày, không ghi log mỗi sự kiện.
      if (before <= APPEND_ONLY_DAILY_CAP) {
        this.logger.warn({ actorId, kind, cap: APPEND_ONLY_DAILY_CAP }, 'Người dùng vượt hạn mức dòng chỉ-thêm trong ngày, bỏ phần vượt');
      }
    }
    return dropped.size ? rows.filter((r) => !dropped.has(r)) : rows;
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
