import './load-env.js';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule, ENV, type Env } from './app.module.js';
import { useRedisRealtime } from './realtime/redis-io.adapter.js';

const app = await NestFactory.create(AppModule, { bufferLogs: true });
app.useLogger(app.get(Logger));
// Gateway chuyển /notifications/* và /ws về service này; /health để ngoài.
app.setGlobalPrefix('notifications', { exclude: ['health'] });
// Web gọi qua gateway khác origin. api-client gửi mọi request kèm cookie (credentials: 'include', để làm mới phiên
// ở core-api), nên phải bật credentials thì trình duyệt mới cho đọc phản hồi; token vẫn đi bằng header Authorization.
app.enableCors({
  origin: app.get<Env>(ENV).WEB_ORIGINS,
  credentials: true,
  methods: ['GET', 'POST'],
});
// /ws (Socket.IO) phát qua Redis để chạy nhiều replica; phải gắn trước app.listen.
await useRedisRealtime(app);
app.enableShutdownHooks();
await app.listen(Number(process.env.PORT ?? 3001), '0.0.0.0');
app.get(Logger).log(`notification-service chạy ở cổng ${process.env.PORT ?? 3001}`);
