import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { CLS_ID, ClsService } from 'nestjs-cls';
import { TRACE_SOURCE_KEY } from '../../platform/trace.js';

export interface Trace {
  /** x-request-id của request, hoặc mã lượt chạy của job. Không có khi chạy ngoài mọi ngữ cảnh (test, script). */
  requestId: string | null;
  source: string | null;
}

/**
 * Ngữ cảnh lần vết của commerce (D1): mã request và nguồn đi theo mọi việc trong cùng request hoặc lượt chạy job,
 * để lịch sử đơn và sự kiện outbox nối được về log HTTP (cùng x-request-id).
 */
@Injectable()
export class TraceContext {
  constructor(@Inject(ClsService) private readonly cls: ClsService) {}

  current(): Trace {
    if (!this.cls.isActive()) return { requestId: null, source: null };
    return { requestId: this.cls.getId() ?? null, source: this.cls.get<string | undefined>(TRACE_SOURCE_KEY) ?? null };
  }

  /** Chạy một lượt job trong ngữ cảnh riêng: mỗi lượt một mã, nguồn là "job:<tên>". */
  runJob<T>(name: string, run: () => Promise<T>): Promise<T> {
    return this.cls.run(() => {
      this.cls.set(CLS_ID, `job-${randomUUID()}`);
      this.cls.set(TRACE_SOURCE_KEY, `job:${name}`);
      return run();
    });
  }
}
