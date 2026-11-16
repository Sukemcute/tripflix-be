import { ClsModule, ClsService } from 'nestjs-cls';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { TraceContext } from './trace-context.js';

describe('TraceContext (D1)', () => {
  it('ngoài mọi ngữ cảnh thì không có mã và nguồn; trong job thì có mã riêng mỗi lượt và nguồn job:<tên>', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [ClsModule.forRoot({ global: true })], providers: [TraceContext] }).compile();
    const trace = new TraceContext(moduleRef.get(ClsService));
    expect(trace.current()).toEqual({ requestId: null, source: null });
    const first = await trace.runJob('expire-holds', async () => trace.current());
    const second = await trace.runJob('expire-holds', async () => trace.current());
    expect(first.source).toBe('job:expire-holds');
    expect(first.requestId).toMatch(/^job-/);
    expect(second.requestId).not.toBe(first.requestId);
  });
});
