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

export class AdminUserDto extends UserDto {
  @ApiProperty({ enum: ['active', 'locked'] }) status!: 'active' | 'locked';
}

export class AdminUserPageDto {
  @ApiProperty({ type: AdminUserDto, isArray: true }) items!: AdminUserDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}
