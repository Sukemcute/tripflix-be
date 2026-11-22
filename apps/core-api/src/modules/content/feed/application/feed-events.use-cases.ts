import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  ContentPostBookingClickedV1Schema,
  ContentPostViewedV1Schema,
  type EventEnvelope,
} from '@tripflix/contracts';
import { STREAMS, type EventBus } from '@tripflix/event-bus';
import type { ZodType } from 'zod';
import type { FeedEventInput } from '../api/feed-events.dto.js';
import { isQualifiedView } from '../domain/view-rules.js';
import { FeedUseCases } from './feed.use-cases.js';

/** Bus ghi stream:app-events; giới hạn độ dài nhỏ hơn stream nghiệp vụ vì analytics đã giữ bản lâu dài. */
export const FEED_EVENT_BUS = Symbol('FEED_EVENT_BUS');

export interface RecordFeedEventsInput {
  events: FeedEventInput[];
  viewerId: string | null;
  /** X-Anon-Id của khách; app gửi kèm cả khi đã đăng nhập thì vẫn giữ để gộp gu. */
  anonId: string | null;
}

/**
 * Nhận lô sự kiện hành vi từ app (F4 Ingest, TF23) và đẩy thẳng vào stream:app-events, không ghi bảng nào.
 * Chỉ nhận sự kiện của bài đang xem được trên feed, nên không ai thổi được lượt xem cho bài ẩn hay bài không có.
 * Lỗi ghi stream chỉ ghi log: mất vài lượt xem không đáng để app phải gửi lại.
 */
@Injectable()
export class FeedEventsUseCases {
  private readonly logger = new Logger(FeedEventsUseCases.name);

  constructor(
    @Inject(FeedUseCases) private readonly feed: FeedUseCases,
    @Inject(FEED_EVENT_BUS) private readonly bus: EventBus,
  ) {}

  async record(input: RecordFeedEventsInput): Promise<{ accepted: number }> {
    const page = await this.feed.getByIds(
      input.events.map((event) => event.postId),
      null,
    );
    const durationByPostId = new Map(page.items.map((card) => [card.postId, card.video.durationSec]));
    const occurredAt = new Date().toISOString();
    const envelopes = input.events.flatMap((event) => {
      if (!durationByPostId.has(event.postId)) return [];
      const envelope = this.toEnvelope(event, input, durationByPostId.get(event.postId) ?? null, occurredAt);
      return envelope ? [envelope] : [];
    });
    await Promise.all(
      envelopes.map((envelope) =>
        this.bus
          .publish(STREAMS.appEvents, envelope)
          .catch((err: unknown) => this.logger.warn({ err, type: envelope.type }, 'Ghi sự kiện hành vi lỗi')),
      ),
    );
    return { accepted: envelopes.length };
  }

  private toEnvelope(
    event: FeedEventInput,
    input: RecordFeedEventsInput,
    durationSec: number | null,
    occurredAt: string,
  ): EventEnvelope | null {
    const actor = { viewerId: input.viewerId, anonId: input.anonId };
    if (event.type === 'view') {
      return this.build(event.eventId, 'content.post.viewed', ContentPostViewedV1Schema, input.viewerId, occurredAt, {
        postId: event.postId,
        ...actor,
        watchedMs: event.watchedMs,
        durationSec,
        isQualified: isQualifiedView(event.watchedMs, durationSec),
        surface: event.surface,
      });
    }
    return this.build(
      event.eventId,
      'content.post.booking_clicked',
      ContentPostBookingClickedV1Schema,
      input.viewerId,
      occurredAt,
      { postId: event.postId, ...actor, hotelId: event.hotelId, surface: event.surface },
    );
  }

  private build(
    eventId: string,
    type: string,
    schema: ZodType,
    userId: string | null,
    occurredAt: string,
    payload: Record<string, unknown>,
  ): EventEnvelope | null {
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      this.logger.warn({ type, issues: parsed.error.issues }, 'Payload sự kiện hành vi sai schema, không phát');
      return null;
    }
    // Giữ eventId của app: app gửi lại lô cũ (mạng chập chờn) thì bên nhận loại trùng được.
    return {
      eventId,
      type,
      version: 1,
      occurredAt,
      producer: 'core-api',
      userId,
      payload: parsed.data as Record<string, unknown>,
    };
  }
}
