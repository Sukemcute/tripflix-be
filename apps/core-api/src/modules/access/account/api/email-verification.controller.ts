import { Body, Controller, HttpCode, HttpStatus, Inject, Post, Req, UseFilters } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiProperty,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { Authenticated, CurrentUser, type AuthUser } from '@tripflix/auth';
import type { Request } from 'express';
import { z } from 'zod';
import { AccessErrorFilter, ZodBody, readRequestMeta } from '../../auth/api/http.js';
import { EmailVerificationUseCases } from '../application/email-verification.use-cases.js';
import {
  INVALID_VERIFY_TOKEN_MESSAGE,
  TOO_MANY_RESENDS_MESSAGE,
  VERIFICATION_SENT_MESSAGE,
} from '../domain/email-verification.js';

export const VerifyEmailRequestSchema = z.object({
  token: z.string().min(1, 'Thiếu mã xác thực email').max(200, 'Mã xác thực email không hợp lệ'),
});

export class VerifyEmailDto {
  @ApiProperty({ description: 'Giá trị ?token= trên link trong email' }) token!: string;
}

export class ResendVerificationResultDto {
  @ApiProperty({
    enum: ['sent', 'already_verified'],
    description: 'already_verified: email đã xác thực, không gửi gì',
  })
  status!: 'sent' | 'already_verified';
  @ApiProperty({ example: VERIFICATION_SENT_MESSAGE }) message!: string;
}

/** Xác thực email (TF05D). Bấm link không cần đăng nhập; gửi lại link thì cần. */
@ApiTags('auth')
@Controller('auth/email')
@UseFilters(AccessErrorFilter)
export class EmailVerificationController {
  constructor(@Inject(EmailVerificationUseCases) private readonly verification: EmailVerificationUseCases) {}

  /**
   * Link dùng một lần. Xong thì client đang đăng nhập gọi POST /auth/refresh để nhận access token mới
   * (claim ev = true), vì token cũ vẫn mang trạng thái chưa xác thực tới khi hết hạn.
   */
  @Post('verify')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBody({ type: VerifyEmailDto })
  @ApiNoContentResponse()
  @ApiBadRequestResponse({ description: INVALID_VERIFY_TOKEN_MESSAGE })
  async verify(
    @Body(new ZodBody(VerifyEmailRequestSchema)) body: z.infer<typeof VerifyEmailRequestSchema>,
    @Req() req: Request,
  ): Promise<void> {
    await this.verification.verify(body, readRequestMeta(req));
  }

  /** Gửi lại link (link cũ hết dùng được). Tối đa 3 lần mỗi giờ mỗi tài khoản. */
  @Post('verification')
  @Authenticated()
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: ResendVerificationResultDto })
  @ApiTooManyRequestsResponse({ description: TOO_MANY_RESENDS_MESSAGE })
  async resend(@CurrentUser() user: AuthUser, @Req() req: Request): Promise<ResendVerificationResultDto> {
    const status = await this.verification.resend(user.userId, readRequestMeta(req));
    return {
      status,
      message: status === 'sent' ? VERIFICATION_SENT_MESSAGE : 'Email của bạn đã được xác thực',
    };
  }
}
