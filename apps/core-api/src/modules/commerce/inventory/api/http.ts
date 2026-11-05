import { type ArgumentsHost, BadRequestException, Catch, ConflictException, type ExceptionFilter, type HttpException, NotFoundException, type PipeTransform } from '@nestjs/common';
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
      default:
        http = new BadRequestException({ message: err.message, errors });
    }
    res.status(http.getStatus()).json(http.getResponse());
  }
}
