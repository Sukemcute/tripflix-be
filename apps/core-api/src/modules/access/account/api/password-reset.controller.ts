import { Body, Controller, HttpCode, HttpStatus, Inject, Post, Req, UseFilters } from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiBody,
  ApiNoContentResponse,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';
import { ENC_PASSWORD_DESCRIPTION, PLAIN_PASSWORD_DESCRIPTION } from '../../auth/api/dto.js';
import { EncryptedPasswords } from '../../auth/api/encrypted-passwords.js';
import { AccessErrorFilter, ZodBody, readRequestMeta } from '../../auth/api/http.js';
import { lookupEmailField, newPasswordField } from '../../auth/api/validation.js';
import { NEW_PASSWORD_MAX, PASSWORD_MIN } from '../../auth/domain/credentials.js';
import { PasswordResetUseCases } from '../application/password-reset.use-cases.js';
import {
  FORGOT_ACCEPTED_MESSAGE,
  INVALID_RESET_TOKEN_MESSAGE,
  TOO_MANY_RESET_REQUESTS_MESSAGE,
} from '../domain/password-reset.js';

export const ForgotPasswordRequestSchema = z.object({
  email: lookupEmailField(),
});

export const ResetPasswordRequestSchema = z.object({
  token: z.string().min(1, 'Thiếu mã đặt lại mật khẩu').max(200, 'Mã đặt lại mật khẩu không hợp lệ'),
  newPassword: newPasswordField(),
});

export class ForgotPasswordDto {
  @ApiProperty({ example: 'khang@example.com' }) email!: string;
}

export class ForgotPasswordAcceptedDto {
  @ApiProperty({ example: FORGOT_ACCEPTED_MESSAGE }) message!: string;
}

export class ResetPasswordDto {
  @ApiProperty({ description: 'Giá trị ?token= trên link trong email' }) token!: string;
  @ApiPropertyOptional({ description: ENC_PASSWORD_DESCRIPTION }) encNewPassword?: string;
  @ApiPropertyOptional({ minLength: PASSWORD_MIN, maxLength: NEW_PASSWORD_MAX, description: PLAIN_PASSWORD_DESCRIPTION })
  newPassword?: string;
}

/** Quên mật khẩu: không cần đăng nhập. */
@ApiTags('auth')
@Controller('auth/password')
@UseFilters(AccessErrorFilter)
export class PasswordResetController {
  constructor(@Inject(PasswordResetUseCases) private readonly resets: PasswordResetUseCases) {}

  /** Luôn 202 cùng một câu, kể cả email không có tài khoản. Có tài khoản đang hoạt động thì gửi email. */
  @Post('forgot')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiBody({ type: ForgotPasswordDto })
  @ApiAcceptedResponse({ type: ForgotPasswordAcceptedDto })
  @ApiTooManyRequestsResponse({ description: TOO_MANY_RESET_REQUESTS_MESSAGE })
  async forgot(
    @Body(new ZodBody(ForgotPasswordRequestSchema)) body: z.infer<typeof ForgotPasswordRequestSchema>,
    @Req() req: Request,
  ): Promise<ForgotPasswordAcceptedDto> {
    await this.resets.requestReset(body, readRequestMeta(req));
    return { message: FORGOT_ACCEPTED_MESSAGE };
  }

  /** Link dùng một lần. Xong thì mọi thiết bị bị đăng xuất, người dùng đăng nhập lại bằng mật khẩu mới. */
  @Post('reset')
  @HttpCode(HttpStatus.NO_CONTENT)
  @EncryptedPasswords({ fields: [{ encrypted: 'encNewPassword', plain: 'newPassword', purpose: 'reset' }] })
  @ApiBody({ type: ResetPasswordDto })
  @ApiNoContentResponse()
  @ApiBadRequestResponse({ description: INVALID_RESET_TOKEN_MESSAGE })
  async reset(
    @Body(new ZodBody(ResetPasswordRequestSchema)) body: z.infer<typeof ResetPasswordRequestSchema>,
    @Req() req: Request,
  ): Promise<void> {
    await this.resets.resetPassword(body, readRequestMeta(req));
  }
}
