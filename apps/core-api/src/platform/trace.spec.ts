import { describe, expect, it } from 'vitest';
import { resolveRequestId } from './platform.module.js';

describe('resolveRequestId (D1)', () => {
  it('dùng mã pino đã gán, rồi tới header x-request-id, không có thì tạo mới và ghi lại vào header cho log', () => {
    expect(resolveRequestId({ id: 'pino-1', headers: {} })).toBe('pino-1');
    expect(resolveRequestId({ headers: { 'x-request-id': 'from-client' } })).toBe('from-client');
    const req = { headers: {} as Record<string, string | string[] | undefined> };
    const id = resolveRequestId(req);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(req.headers['x-request-id']).toBe(id);
  });
});
