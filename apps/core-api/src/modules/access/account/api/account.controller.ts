import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Req,
  Res,
  UseFilters,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Authenticated, CurrentUser, type AuthUser } from '@tripflix/auth';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import { AvatarDecorDto, MyProfileDto } from '../../auth/api/dto.js';
import { EncryptedPasswords } from '../../auth/api/encrypted-passwords.js';
import { AccessErrorFilter, ZodBody, readRequestMeta } from '../../auth/api/http.js';
import { WebSession, isWebClient } from '../../auth/api/web-session.js';
import { AccountUseCases } from '../application/account.use-cases.js';
import {
  AvatarDecorSchema,
  ChangePasswordDto,
  ChangePasswordRequestSchema,
  SessionDto,
  SetAvatarDto,
  SetAvatarRequestSchema,
  UpdateProfileDto,
  UpdateProfileRequestSchema,
} from './dto.js';

const SESSION_ID_PIPE = new ParseUUIDPipe({ exceptionFactory: () => new BadRequestException('Mã phiên không hợp lệ') });

/** "Tài khoản của tôi" cho app và web: mọi API cần access token của chính người dùng. */
@ApiTags('auth')
@ApiBearerAuth()
@Controller('auth')
@UseFilters(AccessErrorFilter)
@Authenticated()
export class AccountController {
  constructor(
    @Inject(AccountUseCases) private readonly account: AccountUseCases,
    @Inject(WebSession) private readonly web: WebSession,
  ) {}

  @Patch('me')
  @ApiBody({ type: UpdateProfileDto })
  @ApiOkResponse({ type: MyProfileDto })
  updateProfile(
    @CurrentUser() user: AuthUser,
    @Body(new ZodBody(UpdateProfileRequestSchema)) body: z.infer<typeof UpdateProfileRequestSchema>,
    @Req() req: Request,
  ) {
    return this.account.updateProfile(user, body, readRequestMeta(req));
  }

  /** Đặt ảnh đại diện (TF109): tải ảnh lên qua POST /media/uploads trước, rồi gửi mediaId. Ảnh không hợp lệ: 400. */
  @Put('me/avatar')
  @ApiBody({ type: SetAvatarDto })
  @ApiOkResponse({ type: MyProfileDto })
  setAvatar(
    @CurrentUser() user: AuthUser,
    @Body(new ZodBody(SetAvatarRequestSchema)) body: z.infer<typeof SetAvatarRequestSchema>,
    @Req() req: Request,
  ) {
    return this.account.setAvatar(user, body.mediaId, readRequestMeta(req));
  }

  /** Xoá ảnh đại diện; đăng nhập Google sau đó không tự gắn lại ảnh Google. */
  @Delete('me/avatar')
  @ApiOkResponse({ type: MyProfileDto })
  removeAvatar(@CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.account.removeAvatar(user, readRequestMeta(req));
  }

  /** Lưu khung và phụ kiện quanh ảnh đại diện (TF109), để người khác cũng thấy. Mã khung, sticker do app định nghĩa. */
  @Put('me/avatar-decor')
  @ApiBody({ type: AvatarDecorDto })
  @ApiOkResponse({ type: MyProfileDto })
  setAvatarDecor(@CurrentUser() user: AuthUser, @Body(new ZodBody(AvatarDecorSchema)) body: z.infer<typeof AvatarDecorSchema>) {
    return this.account.setAvatarDecor(user, body);
  }

  /** Gỡ hết khung và phụ kiện quanh ảnh đại diện. */
  @Delete('me/avatar-decor')
  @ApiOkResponse({ type: MyProfileDto })
  removeAvatarDecor(@CurrentUser() user: AuthUser) {
    return this.account.setAvatarDecor(user, null);
  }

  /** Sai mật khẩu hiện tại: 400. Đổi xong thì các thiết bị khác bị đăng xuất, thiết bị này vẫn dùng tiếp. */
  @Post('password/change')
  @HttpCode(HttpStatus.NO_CONTENT)
  @EncryptedPasswords({
    fields: [
      { encrypted: 'encCurrentPassword', plain: 'currentPassword', purpose: 'change_current' },
      { encrypted: 'encNewPassword', plain: 'newPassword', purpose: 'change_new' },
    ],
  })
  @ApiBody({ type: ChangePasswordDto })
  @ApiNoContentResponse()
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body(new ZodBody(ChangePasswordRequestSchema)) body: z.infer<typeof ChangePasswordRequestSchema>,
    @Req() req: Request,
  ): Promise<void> {
    await this.account.changePassword(user, body, readRequestMeta(req));
  }

  @Get('sessions')
  @ApiOkResponse({ type: SessionDto, isArray: true })
  listSessions(@CurrentUser() user: AuthUser) {
    return this.account.listSessions(user);
  }

  /** Thoát một thiết bị. Phiên không phải của mình: 404. */
  @Delete('sessions/:sessionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async revokeSession(
    @CurrentUser() user: AuthUser,
    @Param('sessionId', SESSION_ID_PIPE) sessionId: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.account.revokeSession(user, sessionId, readRequestMeta(req));
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async logoutAll(
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.account.logoutAll(user, readRequestMeta(req));
    if (isWebClient(req) || this.web.hasRefreshCookie(req)) this.web.clearRefreshCookie(res, req);
  }
}
