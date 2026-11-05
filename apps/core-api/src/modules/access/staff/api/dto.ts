import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';
import { UserDto } from '../../auth/api/dto.js';

export const SearchUsersQuerySchema = z.object({
  query: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
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
