import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';
import { PASSWORD_MAX, PASSWORD_MIN } from '../../auth/domain/credentials.js';
import {
  GENDERS,
  isAllowedAge,
  MAX_AGE,
  MIN_AGE,
  NATIONALITY_PATTERN,
  normalizePhone,
  PHONE_PATTERN,
} from '../domain/personal-info.js';

/** Chuỗi trống (hoặc chỉ có khoảng trắng) nghĩa là xoá trường đó. */
const blankToNull = (value: unknown) => (typeof value === 'string' && value.trim() === '' ? null : value);

/**
 * Chỉ gửi những trường muốn đổi; trường không gửi thì giữ nguyên, gửi null hoặc "" thì xoá (trừ tên hiển thị).
 * Ngày sinh tính tuổi theo ngày hiện tại khi gọi API.
 */
export const UpdateProfileRequestSchema = z
  .object({
    displayName: z.string().trim().min(1, 'Tên hiển thị không được để trống').max(50).optional(),
    phone: z
      .preprocess(
        (v) => (typeof v === 'string' ? (blankToNull(v) === null ? null : normalizePhone(v)) : v),
        z.string().regex(PHONE_PATTERN, 'Số điện thoại gồm 8–15 chữ số, có thể bắt đầu bằng +').nullable(),
      )
      .optional(),
    dateOfBirth: z
      .preprocess(
        blankToNull,
        z.iso
          .date('Ngày sinh không hợp lệ (YYYY-MM-DD)')
          .refine((d) => isAllowedAge(d, new Date()), `Tuổi phải từ ${MIN_AGE} đến ${MAX_AGE}`)
          .nullable(),
      )
      .optional(),
    gender: z.preprocess(blankToNull, z.enum(GENDERS, 'Giới tính không hợp lệ').nullable()).optional(),
    nationality: z
      .preprocess(
        (v) => (typeof v === 'string' ? (blankToNull(v) === null ? null : v.trim().toUpperCase()) : v),
        z.string().regex(NATIONALITY_PATTERN, 'Quốc tịch là mã 2 chữ cái (ví dụ VN)').nullable(),
      )
      .optional(),
  })
  .refine((v) => Object.values(v).some((field) => field !== undefined), 'Cần ít nhất một trường để cập nhật');

export const ChangePasswordRequestSchema = z
  .object({
    currentPassword: z.string().min(1).max(PASSWORD_MAX),
    newPassword: z.string().min(PASSWORD_MIN, `Mật khẩu cần ít nhất ${PASSWORD_MIN} ký tự`).max(PASSWORD_MAX),
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    path: ['newPassword'],
    message: 'Mật khẩu mới phải khác mật khẩu hiện tại',
  });

export class UpdateProfileDto {
  @ApiPropertyOptional({ maxLength: 50, example: 'Khang Nguyễn' }) displayName?: string;
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: '0912345678',
    description: '8–15 chữ số, có thể bắt đầu bằng +; dấu cách, chấm, gạch được bỏ. null hoặc "" để xoá.',
  })
  phone?: string | null;
  @ApiPropertyOptional({ type: String, format: 'date', nullable: true, example: '2000-05-20', description: `Tuổi ${MIN_AGE}–${MAX_AGE}` })
  dateOfBirth?: string | null;
  @ApiPropertyOptional({ enum: GENDERS, nullable: true }) gender?: (typeof GENDERS)[number] | null;
  @ApiPropertyOptional({ type: String, nullable: true, example: 'VN', description: 'ISO 3166-1 alpha-2' })
  nationality?: string | null;
}

export class ChangePasswordDto {
  @ApiProperty() currentPassword!: string;
  @ApiProperty({ minLength: PASSWORD_MIN, maxLength: PASSWORD_MAX }) newPassword!: string;
}

export class SessionDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, nullable: true, example: 'Pixel 8' }) deviceName!: string | null;
  @ApiProperty({ type: String, nullable: true }) userAgent!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) lastUsedAt!: string;
  @ApiProperty({ description: 'Phiên của access token đang gọi' }) isCurrent!: boolean;
}
