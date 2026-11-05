import {
  type ArgumentsHost,
  BadRequestException,
  Catch,
  type ExceptionFilter,
  HttpStatus,
  type PipeTransform,
} from '@nestjs/common';
import type { Response } from 'express';
import type { z } from 'zod';
import { MediaError, type MediaErrorCode } from '../domain/errors.js';

const HTTP_STATUS_BY_CODE: Record<MediaErrorCode, HttpStatus> = {
  MEDIA_TOO_LARGE: HttpStatus.UNPROCESSABLE_ENTITY,
  MEDIA_NOT_FOUND: HttpStatus.NOT_FOUND,
  MEDIA_UPLOAD_NOT_ACTIVE: HttpStatus.CONFLICT,
  MEDIA_INVALID_PART_NUMBER: HttpStatus.BAD_REQUEST,
  MEDIA_UPLOAD_INCOMPLETE: HttpStatus.CONFLICT,
  MEDIA_UPLOAD_EXPIRED: HttpStatus.GONE,
};

/** Kiểm body bằng schema zod; lỗi trả 400 kèm danh sách trường sai. */
export class ZodBody<T extends z.ZodType> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const parsed = this.schema.safeParse(value);
    if (parsed.success) return parsed.data;
    throw new BadRequestException({
      message: 'Dữ liệu gửi lên không hợp lệ',
      errors: parsed.error.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message })),
    });
  }
}

/** Đổi lỗi nghiệp vụ của media sang mã HTTP, trả về dạng { code, message }. */
@Catch(MediaError)
export class MediaErrorFilter implements ExceptionFilter {
  catch(error: MediaError, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    response.status(HTTP_STATUS_BY_CODE[error.code]).json({ code: error.code, message: error.message });
  }
}
