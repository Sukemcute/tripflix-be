import { BadRequestException, type PipeTransform } from '@nestjs/common';
import type { z } from 'zod';

/** Kiểm tra body bằng schema Zod; lỗi trả 400 Bad Request kèm danh sách trường sai. */
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

/** Kiểm tra query parameters bằng schema Zod; lỗi trả 400 Bad Request kèm danh sách trường sai. */
export class ZodQuery<T extends z.ZodType> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const parsed = this.schema.safeParse(value);
    if (parsed.success) return parsed.data;
    throw new BadRequestException({
      message: 'Tham số truy vấn không hợp lệ',
      errors: parsed.error.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message })),
    });
  }
}
