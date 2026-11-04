import { type ArgumentsHost, BadRequestException, Catch, type ExceptionFilter, type HttpException, NotFoundException, type PipeTransform } from '@nestjs/common';
import type { Response } from 'express';
import type { z } from 'zod';
import { CommerceError } from '../domain/errors.js';

/** Kiểm query string bằng schema zod; lỗi trả 400 kèm danh sách trường sai. */
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
    const http: HttpException =
      err.code === 'not_found'
        ? new NotFoundException(err.message)
        : new BadRequestException({ message: err.message, errors: err.field ? [{ field: err.field, message: err.message }] : [] });
    res.status(http.getStatus()).json(http.getResponse());
  }
}
