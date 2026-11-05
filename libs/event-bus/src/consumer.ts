import { eventEnvelopeSchema, type EventEnvelope } from '@tripflix/contracts';
import type { Redis } from 'ioredis';
import { CONSUMER_GROUPS, STREAMS, type StreamName } from './index.js';

export type ConsumerGroup = (typeof CONSUMER_GROUPS)[number];

export interface DeliveryInfo {
  stream: StreamName;
  messageId: string;
  /** Lần giao thứ mấy (1 = lần đầu). */
  deliveryCount: number;
}

export type EventHandler = (event: EventEnvelope, delivery: DeliveryInfo) => Promise<void>;

export interface RedisStreamsConsumerOptions {
  /** Kết nối Redis riêng: XREADGROUP BLOCK giữ kết nối trong lúc chờ. Dùng `redis.duplicate()`. */
  redis: Redis;
  group: ConsumerGroup;
  /** Tên replica, ví dụ hostname; mỗi replica một tên để Redis chia việc. */
  consumer: string;
  streams: StreamName[];
  handler: EventHandler;
  batchSize?: number;
  blockMs?: number;
  /** Việc đã giao nhưng chưa XACK quá lâu thì replica khác lấy lại. */
  claimIdleMs?: number;
  /** Giao quá số lần này mà vẫn lỗi thì chuyển sang stream:dead-letter để xem tay. */
  maxDeliveries?: number;
  onError?: (error: unknown, delivery?: DeliveryInfo) => void;
}

type StreamEntry = [id: string, fields: string[]];

/**
 * Đọc sự kiện từ Redis Streams bằng consumer group (docs/architecture/10 §3.9). Giao ít nhất một lần:
 * xử lý xong mới XACK; lỗi thì để nguyên, quá claimIdleMs thì lấy lại; quá maxDeliveries thì vào dead-letter.
 * Handler phải loại trùng theo eventId.
 */
export class RedisStreamsConsumer {
  private isRunning = false;
  private loop: Promise<void> = Promise.resolve();

  constructor(private readonly options: RedisStreamsConsumerOptions) {}

  /** Tạo group nếu chưa có, đọc từ đầu stream để không bỏ sót sự kiện phát lúc service còn tắt. */
  async ensureGroups(): Promise<void> {
    for (const stream of this.options.streams) {
      try {
        await this.options.redis.xgroup('CREATE', stream, this.options.group, '0', 'MKSTREAM');
      } catch (err) {
        if (!(err instanceof Error) || !err.message.includes('BUSYGROUP')) throw err;
      }
    }
  }

  /** Một vòng: lấy lại việc treo rồi đọc việc mới. Trả về số sự kiện đã xử lý xong. */
  async pollOnce(): Promise<number> {
    let handledCount = 0;
    for (const stream of this.options.streams) {
      for (const entry of await this.claimStale(stream)) {
        if (await this.process(stream, entry, await this.readDeliveryCount(stream, entry[0]))) handledCount += 1;
      }
    }
    const fresh = await this.readNew();
    for (const [stream, entries] of fresh) {
      for (const entry of entries) {
        if (await this.process(stream, entry, 1)) handledCount += 1;
      }
    }
    return handledCount;
  }

  async start(): Promise<void> {
    if (this.isRunning) return;
    await this.ensureGroups();
    this.isRunning = true;
    this.loop = (async () => {
      while (this.isRunning) {
        try {
          await this.pollOnce();
        } catch (err) {
          this.options.onError?.(err);
          await new Promise((resolve) => setTimeout(resolve, 1_000));
        }
      }
    })();
  }

  /** Dừng sau vòng đang chạy (tối đa blockMs). */
  async stop(): Promise<void> {
    this.isRunning = false;
    await this.loop;
  }

  private async claimStale(stream: StreamName): Promise<StreamEntry[]> {
    const { redis, group, consumer, claimIdleMs = 60_000, batchSize = 20 } = this.options;
    const result = (await redis.xautoclaim(stream, group, consumer, claimIdleMs, '0-0', 'COUNT', batchSize)) as [
      string,
      StreamEntry[],
      string[]?,
    ];
    // Entry bị xoá khỏi stream (MAXLEN) trả về null trong danh sách.
    return (result[1] ?? []).filter((e): e is StreamEntry => Array.isArray(e) && Array.isArray(e[1]));
  }

  private async readNew(): Promise<[StreamName, StreamEntry[]][]> {
    const { redis, group, consumer, streams, batchSize = 20, blockMs = 5_000 } = this.options;
    const result = (await redis.xreadgroup(
      'GROUP',
      group,
      consumer,
      'COUNT',
      batchSize,
      'BLOCK',
      blockMs,
      'STREAMS',
      ...streams,
      ...streams.map(() => '>'),
    )) as [string, StreamEntry[]][] | null;
    return (result ?? []).map(([stream, entries]) => [stream as StreamName, entries]);
  }

  private async readDeliveryCount(stream: StreamName, messageId: string): Promise<number> {
    const rows = (await this.options.redis.xpending(stream, this.options.group, messageId, messageId, 1)) as [
      string,
      string,
      number,
      number,
    ][];
    return rows[0]?.[3] ?? 1;
  }

  /** Trả true khi đã XACK (xử lý xong hoặc chuyển dead-letter). */
  private async process(stream: StreamName, [messageId, fields]: StreamEntry, deliveryCount: number): Promise<boolean> {
    const { redis, group, handler, maxDeliveries = 5, onError } = this.options;
    const delivery: DeliveryInfo = { stream, messageId, deliveryCount };
    const raw = fields[fields.indexOf('event') + 1];
    let event: EventEnvelope | undefined;
    try {
      event = eventEnvelopeSchema.parse(JSON.parse(raw ?? '')) as EventEnvelope;
    } catch (err) {
      // Không đọc được thì thử lại cũng vô ích: chuyển dead-letter ngay.
      await this.moveToDeadLetter(delivery, raw, err);
      return true;
    }
    if (deliveryCount > maxDeliveries) {
      await this.moveToDeadLetter(delivery, raw, new Error(`Giao quá ${maxDeliveries} lần`));
      return true;
    }
    try {
      await handler(event, delivery);
    } catch (err) {
      onError?.(err, delivery);
      return false;
    }
    await redis.xack(stream, group, messageId);
    return true;
  }

  private async moveToDeadLetter(delivery: DeliveryInfo, raw: string | undefined, reason: unknown): Promise<void> {
    const { redis, group } = this.options;
    await redis.xadd(
      STREAMS.deadLetter,
      '*',
      'event',
      raw ?? '',
      'stream',
      delivery.stream,
      'group',
      group,
      'messageId',
      delivery.messageId,
      'reason',
      reason instanceof Error ? reason.message : String(reason),
    );
    await redis.xack(delivery.stream, group, delivery.messageId);
  }
}
