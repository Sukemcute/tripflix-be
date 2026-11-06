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
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import { AccessError } from '../domain/errors.js';
import type { RequestMeta } from '../application/ports.js';
import { parseAccessInput } from './validation.js';

/** Kiểm body, query bằng schema zod; lỗi trả 400 kèm danh sách trường sai, câu lỗi tiếng Việt (validation.ts). */
export class ZodBody<T extends z.ZodType> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const parsed = parseAccessInput(this.schema, value);
    if (parsed.success) return parsed.data;
    throw new BadRequestException({ message: 'Dữ liệu gửi lên không hợp lệ', errors: parsed.errors });
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
      case 'staff_rule':
        // Quy tắc quản lý nhân viên chặn thao tác (tự khoá mình, hạ quyền superadmin...).
        http = new ConflictException(err.message);
        break;
      case 'invalid_reset_token':
      case 'invalid_verify_token':
      case 'wrong_password':
        // 400, không phải 401: client hiểu 401 là token hết hạn rồi tự làm mới hoặc đăng xuất.
        http = new BadRequestException(err.message);
        break;
      case 'google_not_configured':
        http = new ServiceUnavailableException(err.message);
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

/** Header của app (mobile, web) mang mã khách vãng lai, để gộp gu khi đăng ký hoặc đăng nhập. */
export const ANON_ID_HEADER = 'x-anon-id';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function readRequestMeta(req: Request): RequestMeta {
  // X-Anon-Id sai dạng thì bỏ qua (không gộp), không làm hỏng đăng nhập.
  const anonId = req.get(ANON_ID_HEADER)?.trim();
  return {
    ip: req.ip ?? 'unknown',
    userAgent: req.get('user-agent') ?? null,
    anonId: anonId && UUID_PATTERN.test(anonId) ? anonId.toLowerCase() : null,
  };
}
