import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ROLES, type Role } from '@tripflix/contracts';
import { z } from 'zod';
import { NEW_PASSWORD_MAX } from '../domain/credentials.js';
import { DISPLAY_NAME_MAX } from '../domain/text-rules.js';
import {
  INVALID_REGISTRATION_CODE,
  REGISTRATION_CODE_PATTERN,
  REGISTRATION_PASSWORD_MIN,
  TERMS_REQUIRED_MESSAGE,
} from '../domain/registration.js';
import { GENDERS } from '../../account/domain/personal-info.js';
import {
  currentPasswordField,
  dateOfBirthField,
  deviceNameField,
  displayNameField,
  genderField,
  nationalityField,
  lookupEmailField,
  registrationPasswordField,
  signupEmailField,
} from './validation.js';

// Schema zod để kiểm dữ liệu vào; class bên dưới chỉ để Swagger sinh contracts/openapi.
// Trường lạ (như role) bị bỏ đi, nên không ai tự cấp quyền khi đăng ký.
// Bước xin mã chỉ cần email (TF056): app bản cũ còn gửi password thì trường đó bị bỏ đi, không lỗi.
export const RegistrationCodeRequestSchema = z.object({
  email: signupEmailField(),
});

// password có thể đến từ encPassword: PasswordDecryptionInterceptor giải mã trước khi schema này kiểm.
export const RegisterRequestSchema = RegistrationCodeRequestSchema.extend({
  password: registrationPasswordField(),
  displayName: displayNameField(),
  registrationId: z.uuid('Yêu cầu gửi mã xác thực email trước khi đăng ký'),
  code: z.string().regex(REGISTRATION_CODE_PATTERN, INVALID_REGISTRATION_CODE),
  // Thông tin cá nhân bắt buộc khi đăng ký bằng mật khẩu (TF06O); cùng luật với PATCH /auth/me.
  dateOfBirth: dateOfBirthField(),
  gender: genderField(),
  nationality: nationalityField(),
  // Phải tick "đã đọc và đồng ý"; phiên bản điều khoản do BE ghi (TERMS_VERSION), không tin client.
  acceptTerms: z.literal(true, TERMS_REQUIRED_MESSAGE),
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

/** Mô tả chung cho các trường enc*: chuỗi mã hoá thay cho mật khẩu gốc (TF056). */
export const ENC_PASSWORD_DESCRIPTION =
  'Mật khẩu đã mã hoá bằng khoá của GET /auth/password-key, dạng "#TFPWD:1:<keyId>:<ts>:<dữ liệu>". ' +
  'Gửi trường này thay cho trường mật khẩu thường tương ứng, không gửi cả hai.';
export const PLAIN_PASSWORD_DESCRIPTION =
  'Cách cũ, gửi mật khẩu gốc. Bị từ chối khi server bật AUTH_PASSWORD_ENCRYPTION_REQUIRED.';

export class RegistrationCodeDto {
  @ApiProperty({ example: 'khang@example.com' }) email!: string;
}

export class PasswordKeyDto {
  @ApiProperty({ example: 'k1' }) keyId!: string;
  @ApiProperty({ description: 'Khoá công khai X25519, 32 byte, base64url' }) publicKey!: string;
  @ApiProperty({ example: 'X25519-HKDF-SHA256-A256GCM' }) algorithm!: string;
  @ApiProperty({ example: 1 }) version!: number;
  @ApiProperty({ example: 1794300000, description: 'Giờ server (giây), để client tính lệch đồng hồ' })
  serverTime!: number;
}

export class RegistrationCodeResultDto {
  @ApiProperty({ format: 'uuid' }) registrationId!: string;
  @ApiProperty({ example: 60, description: 'Số giây phải đợi trước khi xin mã lại cho email này' })
  resendAfterSeconds!: number;
}

export class RegisterDto extends RegistrationCodeDto {
  @ApiPropertyOptional({ description: ENC_PASSWORD_DESCRIPTION }) encPassword?: string;
  @ApiPropertyOptional({
    minLength: REGISTRATION_PASSWORD_MIN,
    maxLength: NEW_PASSWORD_MAX,
    description: PLAIN_PASSWORD_DESCRIPTION,
  })
  password?: string;
  @ApiProperty({ maxLength: DISPLAY_NAME_MAX, example: 'Khang' }) displayName!: string;
  @ApiProperty({ format: 'uuid' }) registrationId!: string;
  @ApiProperty({ pattern: REGISTRATION_CODE_PATTERN.source }) code!: string;
  @ApiProperty({ type: String, format: 'date', example: '2000-05-20' }) dateOfBirth!: string;
  @ApiProperty({ enum: GENDERS }) gender!: (typeof GENDERS)[number];
  @ApiProperty({ minLength: 2, maxLength: 2, example: 'VN', description: 'Mã quốc gia ISO 3166-1 alpha-2' })
  nationality!: string;
  @ApiProperty({ enum: [true], description: 'Đã đọc và đồng ý Điều khoản sử dụng, Chính sách bảo mật' })
  acceptTerms!: true;
}

export class LoginDto {
  @ApiProperty({ example: 'khang@example.com' }) email!: string;
  @ApiPropertyOptional({ description: ENC_PASSWORD_DESCRIPTION }) encPassword?: string;
  @ApiPropertyOptional({ description: PLAIN_PASSWORD_DESCRIPTION }) password?: string;
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
  @ApiProperty({ description: 'Đã xác thực email (TF05D). false: chưa đăng bài, bình luận được; gửi lại link bằng POST /auth/email/verification' })
  emailVerified!: boolean;
  @ApiProperty({ type: String, nullable: true, example: '0912345678' }) phone!: string | null;
  @ApiProperty({ type: String, format: 'date', nullable: true, example: '2000-05-20' }) dateOfBirth!: string | null;
  @ApiProperty({ enum: ['male', 'female', 'other'], nullable: true }) gender!: 'male' | 'female' | 'other' | null;
  @ApiProperty({ type: String, nullable: true, example: 'VN' }) nationality!: string | null;
}

export class JwksDto {
  @ApiProperty({ type: 'array', items: { type: 'object' } }) keys!: Record<string, unknown>[];
}
