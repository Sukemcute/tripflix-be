import { randomUUID } from 'node:crypto';
import type { DynamicModule } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { pino, type Logger } from 'pino';

export interface LoggerOptions {
  service: string;
  level?: string;
  /** Log dễ đọc khi dev; production để JSON. */
  pretty?: boolean;
}

const transport = (pretty?: boolean) =>
  pretty
    ? { target: 'pino-pretty', options: { singleLine: true, translateTime: 'SYS:HH:MM:ss' } }
    : undefined;

/** Logger cho app NestJS: mỗi request có x-request-id (nhận từ gateway hoặc tự tạo), trả lại trong header. */
export function loggerModule({ service, level = 'info', pretty }: LoggerOptions): DynamicModule {
  return LoggerModule.forRoot({
    pinoHttp: {
      name: service,
      level,
      transport: transport(pretty),
      genReqId: (req, res) => {
        const incoming = req.headers['x-request-id'];
        const id = typeof incoming === 'string' && incoming ? incoming : randomUUID();
        res.setHeader('x-request-id', id);
        return id;
      },
    },
  });
}

/** Logger cho tiến trình không phải NestJS (video-worker, script). */
export function createLogger({ service, level = 'info', pretty }: LoggerOptions): Logger {
  return pino({ name: service, level, transport: transport(pretty) });
}
