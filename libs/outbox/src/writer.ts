import { randomUUID } from 'node:crypto';
import { eventEnvelopeSchema, type EventEnvelope } from '@tripflix/contracts';
import type { Db } from '@tripflix/db';
import type { OutboxTable } from './table.js';

export interface NewOutboxEvent {
  /** Dạng <nguồn>.<đối tượng>.<việc>, ví dụ media.transcode_requested. */
  type: string;
  payload: Record<string, unknown>;
  /** Tăng khi đổi payload theo kiểu phá vỡ; mặc định 1. */
  version?: number;
  userId?: string | null;
  traceId?: string;
}

export class InvalidOutboxEventError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidOutboxEventError';
  }
}

/** Tạo phong bì sự kiện và kiểm bằng eventEnvelopeSchema của libs/contracts. */
export function buildEventEnvelope(event: NewOutboxEvent, producer: string, now: Date = new Date()): EventEnvelope {
  const parsed = eventEnvelopeSchema.safeParse({
    eventId: randomUUID(),
    type: event.type,
    version: event.version ?? 1,
    occurredAt: now.toISOString(),
    producer,
    traceId: event.traceId,
    userId: event.userId ?? null,
    payload: event.payload,
  });
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join('.') || '(gốc)').join(', ');
    throw new InvalidOutboxEventError(`Sự kiện ${event.type} không hợp lệ ở: ${fields}`);
  }
  return parsed.data;
}

/**
 * Ghi một sự kiện vào outbox bằng executor được truyền vào. Truyền `tx` của transaction đang mở
 * để sự kiện chỉ được gửi khi thay đổi nghiệp vụ đã commit. Trả về eventId.
 *
 * ```ts
 * await db.transaction(async (tx) => {
 *   await markUploaded(tx, mediaId);
 *   await addOutboxEvent(tx, contentOutboxEvents, { type: 'media.transcode_requested', payload: { mediaId } }, 'core-api/content');
 * });
 * ```
 */
export async function addOutboxEvent(
  executor: Db,
  table: OutboxTable,
  event: NewOutboxEvent,
  producer: string,
): Promise<string> {
  const envelope = buildEventEnvelope(event, producer);
  await executor.insert(table).values({
    id: envelope.eventId,
    type: envelope.type,
    version: envelope.version,
    producer: envelope.producer,
    payload: envelope.payload,
    userId: envelope.userId ?? null,
    traceId: envelope.traceId ?? null,
    occurredAt: new Date(envelope.occurredAt),
  });
  return envelope.eventId;
}
