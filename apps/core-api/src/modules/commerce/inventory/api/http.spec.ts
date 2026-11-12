import type { ArgumentsHost } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { CommerceError } from '../domain/errors.js';
import { CommerceErrorFilter } from './http.js';

function createHttpHost() {
  const response = {
    status: vi.fn<(statusCode: number) => unknown>(),
    json: vi.fn<(body: unknown) => unknown>(),
    setHeader: vi.fn<(name: string, value: string) => unknown>(),
  };
  response.status.mockReturnValue(response);
  const host = {
    switchToHttp: () => ({ getResponse: () => response }),
  } as unknown as ArgumentsHost;
  return { host, response };
}

describe('CommerceErrorFilter', () => {
  it('trả 409 kèm thông báo và chi tiết xung đột', () => {
    const { host, response } = createHttpHost();
    const message = 'Đang có lượt giữ chỗ khác';
    const error = new CommerceError('conflict', message, 'checkIn', { reason: 'LOCK_BUSY', retryAfterMs: 10 });

    new CommerceErrorFilter().catch(error, host);

    expect(response.status).toHaveBeenCalledWith(409);
    expect(response.json).toHaveBeenCalledWith({
      message,
      errors: [{ field: 'checkIn', message }],
      reason: 'LOCK_BUSY',
      retryAfterMs: 10,
    });
  });

  it('trả 404 khi không tìm thấy', () => {
    const { host, response } = createHttpHost();

    new CommerceErrorFilter().catch(new CommerceError('not_found', 'Không tìm thấy đơn hàng'), host);

    expect(response.status).toHaveBeenCalledWith(404);
  });

  it('trả 503 và thời gian thử lại khi mất kết nối', () => {
    const { host, response } = createHttpHost();

    new CommerceErrorFilter().catch({ cause: { code: 'ECONNREFUSED' } }, host);

    expect(response.status).toHaveBeenCalledWith(503);
    expect(response.setHeader).toHaveBeenCalledWith('Retry-After', '5');
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ reason: 'SERVICE_UNAVAILABLE' }));
  });

  it('chuyển lỗi khác cho bộ lọc mặc định', () => {
    const { host } = createHttpHost();
    const error = new Error('boom');
    const catchSpy = vi.spyOn(BaseExceptionFilter.prototype, 'catch').mockImplementation(() => undefined);

    try {
      new CommerceErrorFilter().catch(error, host);

      expect(catchSpy).toHaveBeenCalledWith(error, host);
    } finally {
      catchSpy.mockRestore();
    }
  });
});
