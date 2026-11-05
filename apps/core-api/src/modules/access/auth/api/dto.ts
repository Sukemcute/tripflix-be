import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ROLES, type Role } from '@tripflix/contracts';
import { z } from 'zod';
import { PASSWORD_MAX, PASSWORD_MIN } from '../domain/credentials.js';

// Schema zod để kiểm dữ liệu vào; class bên dưới chỉ để Swagger sinh contracts/openapi.
// Trường lạ (như role) bị bỏ đi, nên không ai tự cấp quyền khi đăng ký.
export const RegisterRequestSchema = z.object({
  email: z.email('Email không hợp lệ').max(254),
  password: z.string().min(PASSWORD_MIN, `Mật khẩu cần ít nhất ${PASSWORD_MIN} ký tự`).max(PASSWORD_MAX),
  displayName: z.string().trim().min(1, 'Tên hiển thị không được để trống').max(50),
});

export const LoginRequestSchema = z.object({
  email: z.string().min(1).max(254),
  password: z.string().min(1).max(PASSWORD_MAX),
  deviceName: z.string().trim().max(100).optional(),
});

// Web, admin không gửi refreshToken trong body (có khi không gửi body): core-api đọc từ cookie tripflix_refresh.
export const RefreshRequestSchema = z.preprocess(
  (v) => v ?? {},
  z.object({
    refreshToken: z.string().min(1).max(200).optional(),
  }),
);

export const GoogleLoginRequestSchema = z.object({
  idToken: z.string().min(1).max(4096),
  deviceName: z.string().trim().max(100).optional(),
});

export class GoogleLoginDto {
  @ApiProperty({ description: 'ID token lấy từ Google Sign-In trên app hoặc web (credential)' }) idToken!: string;
  @ApiPropertyOptional({ example: 'Pixel 8' }) deviceName?: string;
}

export class RegisterDto {
  @ApiProperty({ example: 'khang@example.com' }) email!: string;
  @ApiProperty({ minLength: PASSWORD_MIN, maxLength: PASSWORD_MAX }) password!: string;
  @ApiProperty({ maxLength: 50, example: 'Khang' }) displayName!: string;
}

export class LoginDto {
  @ApiProperty({ example: 'khang@example.com' }) email!: string;
  @ApiProperty() password!: string;
  @ApiPropertyOptional({ example: 'Pixel 8' }) deviceName?: string;
}

export class RefreshDto {
  @ApiPropertyOptional({ description: 'App mobile gửi trong body. Web, admin bỏ trống, token nằm trong cookie tripflix_refresh' })
  refreshToken?: string;
}

export class TokenPairDto {
  @ApiProperty() accessToken!: string;
  @ApiPropertyOptional({
    description: 'Không có khi gửi header X-Tripflix-Client: web; khi đó refresh token nằm trong cookie HttpOnly tripflix_refresh',
  })
  refreshToken?: string;
  @ApiProperty({ enum: ['Bearer'] }) tokenType!: 'Bearer';
  @ApiProperty({ example: 900, description: 'Số giây access token còn dùng được' }) expiresIn!: number;
}

export class UserDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() email!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty({ enum: ROLES }) role!: Role;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class JwksDto {
  @ApiProperty({ type: 'array', items: { type: 'object' } }) keys!: Record<string, unknown>[];
}
