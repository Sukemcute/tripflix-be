import { existsSync } from 'node:fs';
import { hostname } from 'node:os';
import { baseEnvSchema, loadEnv } from '@tripflix/config';
import { createLogger } from '@tripflix/observability';
import { S3ObjectStorage } from '@tripflix/storage';
import { Redis } from 'ioredis';
import { z } from 'zod';
import { TranscodeConsumer } from './consumer/transcode-consumer.js';
import { FfmpegTranscoder } from './transcode/ffmpeg.js';

if (existsSync('.env')) process.loadEnvFile('.env');

const env = loadEnv(
  baseEnvSchema.extend({
    REDIS_URL: z.string().default('redis://localhost:6379'),
    AWS_REGION: z.string().default('ap-southeast-2'),
    S3_MEDIA_BUCKET: z.string().default('tripflix-media-dev'),
    S3_KEY_PREFIX: z.string().default('dev/unknown/'),
    VIDEO_WORKER_CONSUMER_NAME: z.string().optional(),
  }),
);
const log = createLogger({ service: 'video-worker', level: env.LOG_LEVEL, pretty: env.NODE_ENV !== 'production' });
const redis = new Redis(env.REDIS_URL);

const consumer = new TranscodeConsumer({
  redis,
  consumerName: env.VIDEO_WORKER_CONSUMER_NAME || hostname(),
  storage: new S3ObjectStorage({
    region: env.AWS_REGION,
    bucket: env.S3_MEDIA_BUCKET,
    keyPrefix: env.S3_KEY_PREFIX,
    // Worker chỉ ghi file, không tạo link phát.
    cdnBaseUrl: '',
  }),
  transcoder: new FfmpegTranscoder(),
  logger: log,
});

let isStopping = false;

/** Redis chưa sẵn sàng lúc khởi động thì thử lại, không làm worker dừng. */
async function startWithRetry(): Promise<void> {
  while (!isStopping) {
    try {
      await consumer.start();
      log.info('video-worker đã chạy, đang chờ việc từ stream:media');
      return;
    } catch (err) {
      log.error({ err }, 'Chưa bật được consumer, thử lại sau 5 giây');
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
  }
}

async function shutdown(): Promise<void> {
  if (isStopping) return;
  isStopping = true;
  await consumer.stop();
  redis.disconnect();
  log.info('video-worker dừng');
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
void startWithRetry();
