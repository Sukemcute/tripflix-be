import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';
import { PASSWORD_MAX, PASSWORD_MIN } from '../../auth/domain/credentials.js';

export const UpdateProfileRequestSchema = z.object({
  displayName: z.string().trim().min(1, 'Tên hiển thị không được để trống').max(50),
});

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
  @ApiProperty({ maxLength: 50, example: 'Khang Nguyễn' }) displayName!: string;
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
