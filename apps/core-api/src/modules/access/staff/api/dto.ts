import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';
import { ENC_PASSWORD_DESCRIPTION, PLAIN_PASSWORD_DESCRIPTION, UserDto } from '../../auth/api/dto.js';
import { newPasswordField } from '../../auth/api/validation.js';

export const SearchUsersQuerySchema = z.object({
  query: z.string().trim().max(100, 'Từ khoá tối đa 100 ký tự').optional(),
  page: z.coerce
    .number('Số trang phải là số')
    .int('Số trang phải là số nguyên')
    .min(1, 'Số trang từ 1 trở lên')
    .max(1000, 'Số trang tối đa 1000')
    .default(1),
});

export const GrantStaffRequestSchema = z.object({
  userId: z.uuid('userId không hợp lệ'),
});

export class GrantStaffDto {
  @ApiProperty({ format: 'uuid' }) userId!: string;
}

// Không có mật khẩu mặc định (TF056): bỏ trống thì nhân sự nhận email để tự đặt mật khẩu.
// Có mật khẩu thì theo cùng luật với mật khẩu mới (8–64 ký tự, không chỉ có khoảng trắng), không cắt khoảng trắng.
export const CreateUserRequestSchema = z.object({
  email: z.string().trim().email('Email không hợp lệ').max(255),
  displayName: z.string().trim().min(2, 'Tên hiển thị tối thiểu 2 ký tự').max(100),
  password: newPasswordField().optional(),
  role: z.enum(['member', 'moderator', 'superadmin']).default('moderator'),
});

export class CreateUserDto {
  @ApiProperty({ example: 'mod_015@tripflix.vn' }) email!: string;
  @ApiProperty({ example: 'Nguyễn Văn A' }) displayName!: string;
  @ApiPropertyOptional({ description: `${ENC_PASSWORD_DESCRIPTION} Bỏ trống cả hai: gửi email để nhân sự tự đặt mật khẩu.` })
  encPassword?: string;
  @ApiPropertyOptional({ description: PLAIN_PASSWORD_DESCRIPTION }) password?: string;
  @ApiProperty({ enum: ['member', 'moderator', 'superadmin'], default: 'moderator', required: false }) role?: 'member' | 'moderator' | 'superadmin';
}

export class AdminUserDto extends UserDto {
  @ApiProperty({ enum: ['active', 'locked'] }) status!: 'active' | 'locked';
}

export class AdminUserPageDto {
  @ApiProperty({ type: AdminUserDto, isArray: true }) items!: AdminUserDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}
