import type { EventEnvelope } from '@tripflix/contracts';
import type { Redis } from 'ioredis';

/** Stream theo nguồn phát (docs/architecture/10 §3.9). */
export const STREAMS = {
  access: 'stream:core.access',
  content: 'stream:core.content',
  commerce: 'stream:core.commerce',
  media: 'stream:media',
  ai: 'stream:ai',
  appEvents: 'stream:app-events',
  deadLetter: 'stream:dead-letter',
} as const;
export type StreamName = (typeof STREAMS)[keyof typeof STREAMS];

/** Consumer group: một sự kiện đến được mọi group, mỗi group tự XACK. */
export const CONSUMER_GROUPS = ['notification', 'video-worker', 'core-discovery', 'core-analytics'] as const;

/** Code nghiệp vụ chỉ phụ thuộc interface này, để sau đổi sang Kafka không phải sửa nghiệp vụ. */
export interface EventBus {
  publish(stream: StreamName, event: EventEnvelope): Promise<string>;
}

export class RedisStreamsEventBus implements EventBus {
  constructor(
    private readonly redis: Redis,
    private readonly maxLen = 100_000,
  ) {}

  async publish(stream: StreamName, event: EventEnvelope): Promise<string> {
    const id = await this.redis.xadd(
      stream,
      'MAXLEN',
      '~',
      String(this.maxLen),
      '*',
      'event',
      JSON.stringify(event),
    );
    if (!id) throw new Error(`Không ghi được sự kiện ${event.type} vào ${stream}`);
    return id;
  }
}
