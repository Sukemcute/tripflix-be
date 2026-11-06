import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ROLES, type Role } from '@tripflix/contracts';
import { z } from 'zod';
import { PASSWORD_MAX, PASSWORD_MIN } from '../domain/credentials.js';
import {
  currentPasswordField,
  deviceNameField,
  displayNameField,
  lookupEmailField,
  newPasswordField,
  signupEmailField,
} from './validation.js';

// Schema zod để kiểm dữ liệu vào; class bên dưới chỉ để Swagger sinh contracts/openapi.
// Trường lạ (như role) bị bỏ đi, nên không ai tự cấp quyền khi đăng ký.
export const RegisterRequestSchema = z.object({
  email: signupEmailField(),
  password: newPasswordField(),
  displayName: displayNameField(),
});

export const LoginRequestSchema = z.object({
  email: lookupEmailField(),
  password: currentPasswordField(),
  deviceName: deviceNameField(),
});

// Web, admin không gửi refreshToken trong body (có khi không gửi body): core-api đọc từ cookie tripflix_refresh.
export const RefreshRequestSchema = z.preprocess(
  (v) => v ?? {},
  z.object({
    refreshToken: z.string().min(1, 'Thiếu refresh token').max(200, 'Refresh token không hợp lệ').optional(),
  }),
);

export const GoogleLoginRequestSchema = z.object({
  idToken: z.string().min(1, 'Thiếu ID token của Google').max(4096, 'ID token của Google không hợp lệ'),
  deviceName: deviceNameField(),
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

/** GET/PATCH /auth/me: hồ sơ của chính mình, có thông tin cá nhân (không có ở danh sách nhân viên). */
export class MyProfileDto extends UserDto {
  @ApiProperty({ type: String, nullable: true, example: '0912345678' }) phone!: string | null;
  @ApiProperty({ type: String, format: 'date', nullable: true, example: '2000-05-20' }) dateOfBirth!: string | null;
  @ApiProperty({ enum: ['male', 'female', 'other'], nullable: true }) gender!: 'male' | 'female' | 'other' | null;
  @ApiProperty({ type: String, nullable: true, example: 'VN' }) nationality!: string | null;
}

export class JwksDto {
  @ApiProperty({ type: 'array', items: { type: 'object' } }) keys!: Record<string, unknown>[];
}
