import './platform/load-env.js';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import type { CoreEnv } from './platform/env.js';
import { setupHttp } from './platform/http.js';
import { CORE_ENV } from './platform/tokens.js';

// APP_ROLE=api: nhận request. worker: job, consumer, outbox relay (không mở cổng HTTP). all: cả hai, dùng khi dev.
const role = process.env.APP_ROLE ?? 'all';

if (role === 'worker') {
  const app = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  app.get(Logger).log('core-api chạy vai trò worker');
} else {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  const env = app.get<CoreEnv>(CORE_ENV);
  setupHttp(app, { swagger: env.NODE_ENV !== 'production', webOrigins: env.AUTH_WEB_ORIGINS });
  await app.listen(Number(process.env.PORT ?? 3000), '0.0.0.0');
  app.get(Logger).log(`core-api chạy vai trò ${role} ở cổng ${process.env.PORT ?? 3000}`);
}
