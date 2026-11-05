import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Post, Req, Res, UseFilters } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Authenticated, CurrentUser, type AuthUser } from '@tripflix/auth';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import { AuthUseCases, type TokenPair } from '../application/auth.use-cases.js';
import { INVALID_REFRESH_MESSAGE } from '../domain/credentials.js';
import { AccessError } from '../domain/errors.js';
import {
  LoginDto,
  RefreshDto,
  RegisterDto,
  TokenPairDto,
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
  ) {}

  @Post('register')
  @ApiBody({ type: RegisterDto })
  @ApiCreatedResponse({ type: UserDto })
  register(@Body(new ZodBody(RegisterRequestSchema)) body: z.infer<typeof RegisterRequestSchema>, @Req() req: Request) {
    return this.auth.register(body, readRequestMeta(req));
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
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
   * App mobile gửi refreshToken trong body. Web, admin để body trống: đọc cookie, bắt buộc Origin tin cậy.
   * Làm mới lỗi ở chế độ web thì xoá cookie để trình duyệt không gửi token hỏng nữa.
   */
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
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
  @ApiBearerAuth()
  @ApiOkResponse({ type: UserDto })
  getMe(@CurrentUser() user: AuthUser) {
    return this.auth.getMe(user.userId);
  }

  private toWebResponse(res: Response, pair: TokenPair): Omit<TokenPair, 'refreshToken'> {
    const { refreshToken, ...rest } = pair;
    this.web.setRefreshCookie(res, refreshToken);
    return rest;
  }
}
