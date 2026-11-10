import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
  ServiceUnavailableException,
  UseFilters,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiAcceptedResponse,
  ApiBody,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiOkResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Authenticated, CurrentUser, type AuthUser } from '@tripflix/auth';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import { AuthUseCases, type TokenPair } from '../application/auth.use-cases.js';
import { PasswordEncryption } from '../application/password-encryption.js';
import { EncryptedPasswords } from './encrypted-passwords.js';

export const PASSWORD_ENCRYPTION_UNAVAILABLE_MESSAGE = 'Máy chủ chưa bật mã hoá mật khẩu';
import { GOOGLE_LOGIN_FAILED_MESSAGE, GOOGLE_NOT_CONFIGURED_MESSAGE, INVALID_REFRESH_MESSAGE } from '../domain/credentials.js';
import { AccessError } from '../domain/errors.js';
import { REGISTRATION_CODE_COOLDOWN_SECONDS } from '../domain/registration.js';
import {
  GoogleLoginDto,
  GoogleLoginRequestSchema,
  LoginDto,
  PasswordKeyDto,
  RefreshDto,
  RegisterDto,
  RegistrationCodeDto,
  RegistrationCodeResultDto,
  RegistrationCodeRequestSchema,
  TokenPairDto,
  MyProfileDto,
  UserDto,
  LoginRequestSchema,
  RefreshRequestSchema,
  RegisterRequestSchema,
} from './dto.js';
import { AccessErrorFilter, ZodBody, readRequestMeta } from './http.js';
import { UNTRUSTED_ORIGIN_MESSAGE, WebSession, isWebClient } from './web-session.js';

/** Header chọn chế độ web: refresh token trong cookie HttpOnly thay vì body. */
const WEB_CLIENT_API_HEADER = {
  name: 'X-Tripflix-Client',
  required: false,
  enum: ['web'],
  description:
    'Web, admin gửi "web": refresh token đặt vào cookie tripflix_refresh, không trả trong body. Cần Origin nằm trong AUTH_WEB_ORIGINS',
};

@ApiTags('auth')
@Controller('auth')
@UseFilters(AccessErrorFilter)
export class AuthController {
  constructor(
    @Inject(AuthUseCases) private readonly auth: AuthUseCases,
    @Inject(WebSession) private readonly web: WebSession,
    @Inject(PasswordEncryption) private readonly passwords: PasswordEncryption,
  ) {}

  @Post('registration-code')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiBody({ type: RegistrationCodeDto })
  @ApiAcceptedResponse({ type: RegistrationCodeResultDto })
  async requestRegistrationCode(
    @Body(new ZodBody(RegistrationCodeRequestSchema)) body: z.infer<typeof RegistrationCodeRequestSchema>,
    @Req() req: Request,
  ): Promise<RegistrationCodeResultDto> {
    const registrationId = await this.auth.requestRegistrationCode(body.email, readRequestMeta(req));
    return { registrationId, resendAfterSeconds: REGISTRATION_CODE_COOLDOWN_SECONDS };
  }

  /**
   * Khoá công khai để client mã hoá mật khẩu trước khi gửi (TF056). 503 khi server chưa có khoá:
   * client gửi mật khẩu thường (chỉ được khi chưa bật AUTH_PASSWORD_ENCRYPTION_REQUIRED).
   */
  @Get('password-key')
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ type: PasswordKeyDto })
  @ApiServiceUnavailableResponse({ description: PASSWORD_ENCRYPTION_UNAVAILABLE_MESSAGE })
  passwordKey(): PasswordKeyDto {
    const key = this.passwords.publicKey();
    if (!key) throw new ServiceUnavailableException(PASSWORD_ENCRYPTION_UNAVAILABLE_MESSAGE);
    return key;
  }

  @Post('register')
  @EncryptedPasswords({ subjectField: 'email', fields: [{ encrypted: 'encPassword', plain: 'password', purpose: 'register' }] })
  @ApiBody({ type: RegisterDto })
  @ApiCreatedResponse({ type: UserDto })
  register(@Body(new ZodBody(RegisterRequestSchema)) body: z.infer<typeof RegisterRequestSchema>, @Req() req: Request) {
    return this.auth.register(body, readRequestMeta(req));
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @EncryptedPasswords({ subjectField: 'email', fields: [{ encrypted: 'encPassword', plain: 'password', purpose: 'login' }] })
  @ApiHeader(WEB_CLIENT_API_HEADER)
  @ApiBody({ type: LoginDto })
  @ApiOkResponse({ type: TokenPairDto })
  @ApiForbiddenResponse({ description: UNTRUSTED_ORIGIN_MESSAGE })
  async login(
    @Body(new ZodBody(LoginRequestSchema)) body: z.infer<typeof LoginRequestSchema>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const isWeb = isWebClient(req);
    if (isWeb) this.web.assertTrustedOrigin(req);
    const pair = await this.auth.login(body, readRequestMeta(req));
    return isWeb ? this.toWebResponse(res, pair) : pair;
  }

  /**
   * Đăng nhập bằng Google: app, web gửi ID token lấy từ Google Sign-In. Lần đầu tạo member (hoặc liên kết vào
   * tài khoản trùng email), lần sau vào đúng tài khoản đó. Chế độ web (cookie) giống /auth/login.
   */
  @Post('google')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @ApiHeader(WEB_CLIENT_API_HEADER)
  @ApiBody({ type: GoogleLoginDto })
  @ApiOkResponse({ type: TokenPairDto })
  @ApiUnauthorizedResponse({ description: GOOGLE_LOGIN_FAILED_MESSAGE })
  @ApiForbiddenResponse({ description: UNTRUSTED_ORIGIN_MESSAGE })
  @ApiServiceUnavailableResponse({ description: GOOGLE_NOT_CONFIGURED_MESSAGE })
  async loginWithGoogle(
    @Body(new ZodBody(GoogleLoginRequestSchema)) body: z.infer<typeof GoogleLoginRequestSchema>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const isWeb = isWebClient(req);
    if (isWeb) this.web.assertTrustedOrigin(req);
    const pair = await this.auth.loginWithGoogle(body, readRequestMeta(req));
    return isWeb ? this.toWebResponse(res, pair) : pair;
  }

  /**
   * App mobile gửi refreshToken trong body. Web, admin để body trống: đọc cookie, bắt buộc Origin tin cậy.
   * Làm mới lỗi ở chế độ web thì xoá cookie để trình duyệt không gửi token hỏng nữa.
   */
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @ApiHeader(WEB_CLIENT_API_HEADER)
  @ApiBody({ type: RefreshDto, required: false })
  @ApiOkResponse({ type: TokenPairDto })
  @ApiForbiddenResponse({ description: UNTRUSTED_ORIGIN_MESSAGE })
  async refresh(
    @Body(new ZodBody(RefreshRequestSchema)) body: z.infer<typeof RefreshRequestSchema>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const cookieToken = this.web.readRefreshToken(req);
    const isFromCookie = body.refreshToken === undefined && cookieToken !== undefined;
    const isWeb = isWebClient(req) || isFromCookie;
    if (isWeb) this.web.assertTrustedOrigin(req);

    const refreshToken = body.refreshToken ?? cookieToken;
    try {
      if (!refreshToken) throw new AccessError('invalid_refresh', INVALID_REFRESH_MESSAGE);
      const pair = await this.auth.refresh(refreshToken, readRequestMeta(req));
      return isWeb ? this.toWebResponse(res, pair) : pair;
    } catch (err) {
      if (isWeb && err instanceof AccessError) this.web.clearRefreshCookie(res);
      throw err;
    }
  }

  /** Xoá phiên của access token; web có cookie thì xoá luôn cookie. */
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Authenticated()
  @ApiBearerAuth()
  async logout(
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logout(user, readRequestMeta(req));
    if (isWebClient(req) || this.web.hasRefreshCookie(req)) this.web.clearRefreshCookie(res);
  }

  @Get('me')
  @Authenticated()
  @Header('Cache-Control', 'no-store')
  @ApiBearerAuth()
  @ApiOkResponse({ type: MyProfileDto })
  getMe(@CurrentUser() user: AuthUser) {
    return this.auth.getMe(user.userId);
  }

  private toWebResponse(res: Response, pair: TokenPair): Omit<TokenPair, 'refreshToken'> {
    this.web.setRefreshCookie(res, pair.refreshToken);
    return { accessToken: pair.accessToken, tokenType: pair.tokenType, expiresIn: pair.expiresIn };
  }
}
