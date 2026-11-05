import { type ArgumentsHost, BadRequestException, Catch, ConflictException, type ExceptionFilter, HttpException, HttpStatus, NotFoundException, type PipeTransform } from '@nestjs/common';
import type { Response } from 'express';
import type { z } from 'zod';
import { CommerceError } from '../domain/errors.js';

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

/** Đổi lỗi nghiệp vụ của commerce sang mã HTTP. */
@Catch(CommerceError)
export class CommerceErrorFilter implements ExceptionFilter {
  catch(err: CommerceError, host: ArgumentsHost) {
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
        http = new BadRequestException({ message: err.message, errors });
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
