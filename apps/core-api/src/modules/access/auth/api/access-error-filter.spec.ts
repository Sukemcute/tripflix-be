import type { ArgumentsHost } from '@nestjs/common';
import { AccessError } from '../domain/errors.js';
import { AccessErrorFilter } from './http.js';

function catchToResponse(err: AccessError) {
  const res = { headers: {} as Record<string, string>, statusCode: 0, body: undefined as unknown };
  const response = {
    setHeader: (name: string, value: string) => (res.headers[name] = value),
    status: (code: number) => ((res.statusCode = code), response),
    json: (body: unknown) => (res.body = body),
  };
  const host = { switchToHttp: () => ({ getResponse: () => response }) } as unknown as ArgumentsHost;
  new AccessErrorFilter().catch(err, host);
  return res;
}

describe('AccessErrorFilter', () => {
  it('server_busy: 503, Retry-After trong header và body', () => {
    const res = catchToResponse(new AccessError('server_busy', 'Hệ thống đang bận', 2));
    expect(res.statusCode).toBe(503);
    expect(res.headers['Retry-After']).toBe('2');
    expect(res.body).toMatchObject({ statusCode: 503, message: 'Hệ thống đang bận', retryAfterSeconds: 2 });
  });
});
