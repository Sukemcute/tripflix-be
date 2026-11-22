import type { EventEnvelope } from '@tripflix/contracts';

/**
 * Port phát sự kiện từ module content ra event bus hoặc lưu vào outbox.
 */
export interface EventPublisherPort {
  publish(event: EventEnvelope): Promise<void>;
}

export const EVENT_PUBLISHER_PORT = Symbol('EVENT_PUBLISHER_PORT');
