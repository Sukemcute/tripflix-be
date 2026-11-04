import { existsSync } from 'node:fs';
import { baseEnvSchema, loadEnv } from '@tripflix/config';
import { createLogger } from '@tripflix/observability';
import { Redis } from 'ioredis';
import { z } from 'zod';

if (existsSync('.env')) process.loadEnvFile('.env');

const env = loadEnv(
  baseEnvSchema.extend({
    REDIS_URL: z.string().default('redis://localhost:6379'),
  }),
);
const log = createLogger({ service: 'video-worker', level: env.LOG_LEVEL, pretty: env.NODE_ENV !== 'production' });
const redis = new Redis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });

// Khung video-worker. Phần sẽ làm (Phong): consumer/ (group "video-worker"), transcode/ (FFmpeg → HLS 360p/540p/720p),
// storage/ (đọc file gốc, ghi r{n}/ lên S3) — xem docs/architecture/10 §3.1 và tài liệu Feed.
const ready = await redis.ping().then((r) => r === 'PONG').catch(() => false);
log.info({ redis: ready }, 'video-worker đã chạy, đang chờ sự kiện media');

const keepAlive = setInterval(() => undefined, 60_000);
const shutdown = () => {
  clearInterval(keepAlive);
  redis.disconnect();
  log.info('video-worker dừng');
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
