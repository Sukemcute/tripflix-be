import {
  type ArgumentsHost,
  BadRequestException,
  Catch,
  ConflictException,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  NotFoundException,
  type PipeTransform,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import { AccessError } from '../domain/errors.js';
import type { RequestMeta } from '../application/ports.js';

/** Kiểm body bằng schema zod; lỗi trả 400 kèm danh sách trường sai. */
export class ZodBody<T extends z.ZodType> implements PipeTransform<unknown, z.infer<T>> {
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

/** Đổi lỗi nghiệp vụ của access sang mã HTTP. */
@Catch(AccessError)
export class AccessErrorFilter implements ExceptionFilter {
  catch(err: AccessError, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    let http: HttpException;
    switch (err.code) {
      case 'email_taken':
        http = new ConflictException(err.message);
        break;
      case 'not_found':
        http = new NotFoundException(err.message);
        break;
      case 'too_many_attempts':
        if (err.retryAfterSeconds) res.setHeader('Retry-After', String(err.retryAfterSeconds));
        http = new HttpException(
          { statusCode: HttpStatus.TOO_MANY_REQUESTS, message: err.message, error: 'Too Many Requests' },
          HttpStatus.TOO_MANY_REQUESTS,
        );
        break;
      default:
        http = new UnauthorizedException(err.message);
    }
    res.status(http.getStatus()).json(http.getResponse());
  }
}

export function requestMeta(req: Request): RequestMeta {
  return { ip: req.ip ?? 'unknown', userAgent: req.get('user-agent') ?? null };
}
