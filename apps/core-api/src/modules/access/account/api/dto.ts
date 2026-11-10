import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';
import { ENC_PASSWORD_DESCRIPTION, PLAIN_PASSWORD_DESCRIPTION } from '../../auth/api/dto.js';
import {
  currentPasswordField,
  dateOfBirthField,
  displayNameField,
  genderField,
  nationalityField,
  newPasswordField,
} from '../../auth/api/validation.js';
import { NEW_PASSWORD_MAX, PASSWORD_MIN } from '../../auth/domain/credentials.js';
import { DISPLAY_NAME_MAX } from '../../auth/domain/text-rules.js';
import { GENDERS, MAX_AGE, MIN_AGE, normalizePhone, PHONE_PATTERN } from '../domain/personal-info.js';

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
    dateOfBirth: z.preprocess(blankToNull, dateOfBirthField().nullable()).optional(),
    gender: z.preprocess(blankToNull, genderField().nullable()).optional(),
    nationality: z.preprocess(blankToNull, nationalityField().nullable()).optional(),
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
  @ApiPropertyOptional({ description: ENC_PASSWORD_DESCRIPTION }) encCurrentPassword?: string;
  @ApiPropertyOptional({ description: PLAIN_PASSWORD_DESCRIPTION }) currentPassword?: string;
  @ApiPropertyOptional({ description: ENC_PASSWORD_DESCRIPTION }) encNewPassword?: string;
  @ApiPropertyOptional({ minLength: PASSWORD_MIN, maxLength: NEW_PASSWORD_MAX, description: PLAIN_PASSWORD_DESCRIPTION })
  newPassword?: string;
}

export class SessionDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, nullable: true, example: 'Pixel 8' }) deviceName!: string | null;
  @ApiProperty({ type: String, nullable: true }) userAgent!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) lastUsedAt!: string;
  @ApiProperty({ description: 'Phiên của access token đang gọi' }) isCurrent!: boolean;
}
