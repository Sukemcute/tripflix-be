import './load-env.js';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';

const app = await NestFactory.create(AppModule, { bufferLogs: true });
app.useLogger(app.get(Logger));
// Gateway chuyển /notifications/* và /ws về service này; /health để ngoài.
app.setGlobalPrefix('notifications', { exclude: ['health'] });
app.enableShutdownHooks();
await app.listen(Number(process.env.PORT ?? 3001), '0.0.0.0');
app.get(Logger).log(`notification-service chạy ở cổng ${process.env.PORT ?? 3001}`);
