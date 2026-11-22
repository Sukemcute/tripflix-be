import { type ArgumentsHost, BadRequestException, Catch, ConflictException, HttpException, HttpStatus, Logger, NotFoundException, type PipeTransform } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { Response } from 'express';
import type { z } from 'zod';
import { CommerceError } from '../domain/errors.js';
import { DATABASE_UNAVAILABLE_MESSAGE, RETRY_AFTER_SECONDS, isDatabaseUnavailable } from './database-unavailable.js';

/** Kiểm query string hoặc body bằng schema zod; lỗi trả 400 kèm danh sách trường sai. */
export class ZodQuery<T extends z.ZodType> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const parsed = this.schema.safeParse(value);
    if (parsed.success) return parsed.data;
    throw new BadRequestException({
      message: 'Dữ liệu gửi lên không hợp lệ',
      errors: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
    });
  }
}

/**
 * Đổi lỗi nghiệp vụ của commerce sang mã HTTP. Database không phục vụ được (tắt, hết kết nối pool) thì trả 503
 * kèm Retry-After thay vì 500 chung chung: client biết là lỗi tạm, thử lại sau. Lỗi khác để Nest xử lý như cũ.
 */
@Catch()
export class CommerceErrorFilter extends BaseExceptionFilter {
  private readonly logger = new Logger('CommerceErrorFilter');

  override catch(exception: unknown, host: ArgumentsHost) {
    if (exception instanceof CommerceError) return this.sendCommerceError(exception, host);
    if (isDatabaseUnavailable(exception)) {
      this.logger.warn({ err: exception }, 'Database không phục vụ được, trả 503');
      const res = host.switchToHttp().getResponse<Response>();
      res.setHeader('Retry-After', String(RETRY_AFTER_SECONDS));
      res.status(HttpStatus.SERVICE_UNAVAILABLE).json({ statusCode: HttpStatus.SERVICE_UNAVAILABLE, message: DATABASE_UNAVAILABLE_MESSAGE, reason: 'SERVICE_UNAVAILABLE', error: 'Service Unavailable' });
      return;
    }
    return super.catch(exception, host);
  }

  private sendCommerceError(err: CommerceError, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const errors = err.field ? [{ field: err.field, message: err.message }] : [];
    let http: HttpException;
    switch (err.code) {
      case 'not_found':
        http = new NotFoundException(err.message);
        break;
      case 'conflict':
        http = new ConflictException({ message: err.message, errors, ...err.details });
        break;
      case 'gone':
        http = new HttpException({ statusCode: HttpStatus.GONE, message: err.message, error: 'Gone' }, HttpStatus.GONE);
        break;
      case 'rate_limited':
        http = new HttpException({ statusCode: HttpStatus.TOO_MANY_REQUESTS, message: err.message, error: 'Too Many Requests' }, HttpStatus.TOO_MANY_REQUESTS);
        break;
      case 'payment_failed':
        http = new HttpException({ statusCode: HttpStatus.PAYMENT_REQUIRED, message: err.message, errors, ...err.details }, HttpStatus.PAYMENT_REQUIRED);
        break;
      default:
        // details (nếu có) có thể thay errors bằng danh sách đủ các trường sai.
        http = new BadRequestException({ message: err.message, errors, ...err.details });
    }
    res.status(http.getStatus()).json(http.getResponse());
  }
}

/** Khai báo header Idempotency-Key cho Swagger / OpenAPI (libs/idempotency đọc header này). */
export const IDEMPOTENCY_KEY_HEADER = {
  name: 'Idempotency-Key',
  required: true,
  description: 'Chuỗi ngẫu nhiên (UUID) tạo một lần cho mỗi thao tác; gửi lại đúng chuỗi đó khi thử lại để không xử lý hai lần',
};
