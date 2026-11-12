import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { DiscoverySearchPerformedV1Schema, DiscoveryStaysSearchedV1Schema, type EventEnvelope } from '@tripflix/contracts';
import { STREAMS, type EventBus } from '@tripflix/event-bus';
import type { ZodType } from 'zod';
import { placeIdOfName } from '../domain/places.js';
import type { ExploreResultPage } from './explore.use-cases.js';

export const SEARCH_EVENT_BUS = Symbol('SEARCH_EVENT_BUS');

/**
 * Phát discovery.search.performed / discovery.stays.searched cho gợi ý (chỉ khi đã đăng nhập).
 * Bắn rồi quên: không await trên đường trả kết quả, lỗi chỉ ghi log. Không đưa câu tìm `q` hay vị trí `loc` vào payload.
 */
@Injectable()
export class SearchEventsPublisher {
  private readonly logger = new Logger(SearchEventsPublisher.name);

  constructor(@Inject(SEARCH_EVENT_BUS) private readonly bus: EventBus) {}

  searchPerformed(
    userId: string,
    input: { surface: 'explore' | 'posts'; understood: ExploreResultPage['understood']; postType: string | null; resultCount: number },
  ): void {
    const place = input.understood.place ? placeIdOfName(input.understood.place) : null;
    this.fire('discovery.search.performed', DiscoverySearchPerformedV1Schema, userId, {
      userId,
      surface: input.surface,
      placeIds: place ? [place] : [],
      intent: input.understood.intents[0] ?? null,
      budgetMax: input.understood.budget === null ? null : Math.round(input.understood.budget),
      postType: input.postType,
      resultCount: input.resultCount,
    });
  }

  staysSearched(
    userId: string,
    input: { placeId: string; checkIn: string; checkOut: string; adults: number; rooms: number | null; minStars: number | null; priceMax: number | null; resultCount: number },
  ): void {
    this.fire('discovery.stays.searched', DiscoveryStaysSearchedV1Schema, userId, { userId, ...input });
  }

  private fire(type: string, schema: ZodType, userId: string, payload: Record<string, unknown>): void {
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      this.logger.warn({ type, issues: parsed.error.issues }, 'Payload sự kiện tìm kiếm sai schema, không phát');
      return;
    }
    const envelope: EventEnvelope = {
      eventId: randomUUID(),
      type,
      version: 1,
      occurredAt: new Date().toISOString(),
      producer: 'core-api',
      userId,
      payload: parsed.data as Record<string, unknown>,
    };
    void this.bus.publish(STREAMS.discovery, envelope).catch((err: unknown) => this.logger.warn({ err, type }, 'Phát sự kiện tìm kiếm lỗi'));
  }
}
