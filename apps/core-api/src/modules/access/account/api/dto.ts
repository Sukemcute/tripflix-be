import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';
import { currentPasswordField, displayNameField, newPasswordField, whenValid } from '../../auth/api/validation.js';
import { NEW_PASSWORD_MAX, PASSWORD_MIN } from '../../auth/domain/credentials.js';
import { DISPLAY_NAME_MAX } from '../../auth/domain/text-rules.js';
import { isKnownCountry } from '../domain/countries.js';
import {
  GENDERS,
  isAllowedAge,
  MAX_AGE,
  MIN_AGE,
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
    displayName: displayNameField().optional(),
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
          .refine((d) => isAllowedAge(d, new Date()), { message: `Tuổi phải từ ${MIN_AGE} đến ${MAX_AGE}`, ...whenValid })
          .nullable(),
      )
      .optional(),
    gender: z.preprocess(blankToNull, z.enum(GENDERS, 'Giới tính là male, female hoặc other').nullable()).optional(),
    nationality: z
      .preprocess(
        (v) => (typeof v === 'string' ? (blankToNull(v) === null ? null : v.trim().toUpperCase()) : v),
        z.string().refine(isKnownCountry, 'Quốc tịch là mã quốc gia 2 chữ cái (ví dụ VN)').nullable(),
      )
      .optional(),
  })
  .refine((v) => Object.values(v).some((field) => field !== undefined), 'Cần ít nhất một trường để cập nhật');

export const ChangePasswordRequestSchema = z
  .object({
    currentPassword: currentPasswordField(),
    newPassword: newPasswordField(),
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    path: ['newPassword'],
    message: 'Mật khẩu mới phải khác mật khẩu hiện tại',
  });

export class UpdateProfileDto {
  @ApiPropertyOptional({ maxLength: DISPLAY_NAME_MAX, example: 'Khang Nguyễn' }) displayName?: string;
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
  @ApiProperty({ minLength: PASSWORD_MIN, maxLength: NEW_PASSWORD_MAX }) newPassword!: string;
}

export class SessionDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, nullable: true, example: 'Pixel 8' }) deviceName!: string | null;
  @ApiProperty({ type: String, nullable: true }) userAgent!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) lastUsedAt!: string;
  @ApiProperty({ description: 'Phiên của access token đang gọi' }) isCurrent!: boolean;
}
