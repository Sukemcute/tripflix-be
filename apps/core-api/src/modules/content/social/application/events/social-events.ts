import { randomUUID } from 'node:crypto';
import type { EventEnvelope } from '@tripflix/contracts';

export function createSocialEvent<T extends Record<string, unknown>>(params: {
  type: string;
  userId?: string | null;
  payload: T;
  traceId?: string;
}): EventEnvelope<T> {
  return {
    eventId: randomUUID(),
    type: params.type,
    version: 1,
    occurredAt: new Date().toISOString(),
    producer: 'core-api:content',
    userId: params.userId ?? null,
    traceId: params.traceId,
    payload: params.payload,
  };
}
