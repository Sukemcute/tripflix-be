import { randomUUID } from 'node:crypto';
import {
  ContentMediaTranscodeRequestedV1Schema,
  eventEnvelopeSchema,
  type EventEnvelope,
  type MediaRenditionCompletedV1,
  type MediaTranscodeFailedV1,
} from '@tripflix/contracts';
import { RedisStreamsConsumer, RedisStreamsEventBus, STREAMS, type DeliveryInfo } from '@tripflix/event-bus';
import type { Redis } from 'ioredis';
import { TranscodeJob, TranscodeLevelError } from '../transcode/transcode-job.js';
import type { ObjectStorage } from '@tripflix/storage';
import type { Transcoder } from '../transcode/ffmpeg.js';

const CONSUMER_GROUP = 'video-worker';
const TRANSCODE_REQUESTED_TYPE = 'content.media.transcode_requested';
const EVENT_PRODUCER = 'video-worker';
const MAX_REASON_CHARS = 500;

export const MAX_TRANSCODE_ATTEMPTS = 3;
const DEFAULT_CLAIM_IDLE_MS = 2 * 60_000;
const DEFAULT_HEARTBEAT_MS = 30_000;

export interface TranscodeConsumerLogger {
  info(fields: object, message: string): void;
  error(fields: object, message: string): void;
}

export interface TranscodeConsumerOptions {
  /** Kết nối thường để gửi sự kiện và báo còn sống. Consumer tự tạo kết nối riêng vì XREADGROUP BLOCK giữ kết nối. */
  redis: Redis;
  consumerName: string;
  storage: ObjectStorage;
  transcoder: Transcoder;
  logger: TranscodeConsumerLogger;
  claimIdleMs?: number;
  heartbeatMs?: number;
  blockMs?: number;
}

/**
 * Consumer group "video-worker": nhận việc chuyển mã từ stream:media, gửi kết quả lên cùng stream.
 * Worker không có database nên không có outbox: gửi kết quả xong mới XACK. Chết giữa hai bước thì
 * việc được giao lại, bên nhận loại trùng theo (assetId, level).
 */
export class TranscodeConsumer {
  private readonly bus: RedisStreamsEventBus;
  private readonly consumer: RedisStreamsConsumer;
  private readonly connection: Redis;
  private readonly abortController = new AbortController();

  constructor(private readonly options: TranscodeConsumerOptions) {
    this.bus = new RedisStreamsEventBus(options.redis);
    this.connection = options.redis.duplicate();
    this.consumer = new RedisStreamsConsumer({
      redis: this.connection,
      group: CONSUMER_GROUP,
      consumer: options.consumerName,
      streams: [STREAMS.media],
      handler: (event, delivery) => this.handle(event, delivery),
      // Mỗi worker chỉ làm một việc cùng lúc; cần nhiều hơn thì thêm worker.
      batchSize: 1,
      claimIdleMs: options.claimIdleMs ?? DEFAULT_CLAIM_IDLE_MS,
      ...(options.blockMs === undefined ? {} : { blockMs: options.blockMs }),
      onError: (err, delivery) => options.logger.error({ err, ...delivery }, 'Xử lý việc chuyển mã lỗi, sẽ thử lại'),
    });
  }

  async start(): Promise<void> {
    await this.consumer.start();
  }

  /** Dừng FFmpeg đang chạy và không XACK, để việc được giao lại. */
  async stop(): Promise<void> {
    this.abortController.abort();
    await this.consumer.stop();
    this.connection.disconnect();
  }

  private async handle(event: EventEnvelope, delivery: DeliveryInfo): Promise<void> {
    // stream:media còn chứa kết quả của chính worker; bỏ qua để chúng được XACK.
    if (event.type !== TRANSCODE_REQUESTED_TYPE) return;
    const request = ContentMediaTranscodeRequestedV1Schema.parse(event.payload);
    const { signal } = this.abortController;
    const job = new TranscodeJob(this.options.storage, this.options.transcoder, (rendition) =>
      this.publishRendition(event, rendition),
    );

    const stopHeartbeat = this.startHeartbeat(delivery);
    try {
      await job.run(request, signal);
      this.options.logger.info({ assetId: request.assetId, revision: request.revision }, 'Chuyển mã xong');
    } catch (error) {
      if (signal.aborted) throw error;
      if (delivery.deliveryCount < MAX_TRANSCODE_ATTEMPTS) throw error;
      await this.publishFailure(event, request.assetId, error, delivery.deliveryCount);
    } finally {
      stopHeartbeat();
    }
  }

  /**
   * Video 5 phút có thể chuyển mã lâu hơn ngưỡng nhận lại. XCLAIM cho chính mình đặt lại thời gian im lặng,
   * JUSTID để không tăng số lần giao. Nhờ vậy worker khác chỉ nhận lại khi worker này thật sự đã chết.
   */
  private startHeartbeat({ stream, messageId }: DeliveryInfo): () => void {
    const { redis, consumerName, heartbeatMs = DEFAULT_HEARTBEAT_MS, logger } = this.options;
    const timer = setInterval(() => {
      redis.xclaim(stream, CONSUMER_GROUP, consumerName, 0, messageId, 'JUSTID').catch((err: unknown) => {
        logger.error({ err, messageId }, 'Không báo còn sống được');
      });
    }, heartbeatMs);
    return () => clearInterval(timer);
  }

  private async publishRendition(request: EventEnvelope, rendition: MediaRenditionCompletedV1): Promise<void> {
    await this.publish(request, 'media.rendition.completed', rendition);
    this.options.logger.info({ assetId: rendition.assetId, qualityLevel: rendition.level }, 'Xong một mức chất lượng');
  }

  private async publishFailure(request: EventEnvelope, assetId: string, error: unknown, attempts: number): Promise<void> {
    const level = error instanceof TranscodeLevelError ? error.level : 360;
    const message = error instanceof Error ? error.message : String(error);
    const payload: MediaTranscodeFailedV1 = { assetId, level, reason: message.slice(0, MAX_REASON_CHARS) || 'Không rõ lỗi', attempts };
    await this.publish(request, 'media.transcode.failed', payload);
    this.options.logger.error({ assetId, qualityLevel: level, attempts, err: error }, 'Chuyển mã lỗi quá số lần thử');
  }

  private async publish(request: EventEnvelope, type: string, payload: MediaRenditionCompletedV1 | MediaTranscodeFailedV1): Promise<void> {
    const envelope = eventEnvelopeSchema.parse({
      eventId: randomUUID(),
      type,
      version: 1,
      occurredAt: new Date().toISOString(),
      producer: EVENT_PRODUCER,
      userId: request.userId ?? null,
      ...(request.traceId === undefined ? {} : { traceId: request.traceId }),
      payload,
    });
    await this.bus.publish(STREAMS.media, envelope);
  }
}
