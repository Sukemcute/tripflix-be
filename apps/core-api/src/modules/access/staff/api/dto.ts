import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';
import { UserDto } from '../../auth/api/dto.js';

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

// TF056: superadmin không đặt mật khẩu hộ. Tài khoản tạo ra chưa có mật khẩu, nhân sự nhận email để tự đặt;
// trường password/encPassword gửi kèm bị bỏ qua. Chỉ tạo được kiểm duyệt viên: superadmin tạo nhầm không gỡ được qua giao diện.
export const CreateUserRequestSchema = z.object({
  email: z.string().trim().email('Email không hợp lệ').max(255),
  displayName: z.string().trim().min(2, 'Tên hiển thị tối thiểu 2 ký tự').max(100),
  role: z.enum(['moderator'], 'Chỉ tạo được tài khoản kiểm duyệt viên').default('moderator'),
});

export class CreateUserDto {
  @ApiProperty({ example: 'mod_015@tripflix.vn' }) email!: string;
  @ApiProperty({ example: 'Nguyễn Văn A' }) displayName!: string;
  @ApiProperty({ enum: ['moderator'], default: 'moderator', required: false }) role?: 'moderator';
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
