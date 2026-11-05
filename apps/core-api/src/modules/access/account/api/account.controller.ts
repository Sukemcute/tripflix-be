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
  Req,
  UseFilters,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Authenticated, CurrentUser, type AuthUser } from '@tripflix/auth';
import type { Request } from 'express';
import type { z } from 'zod';
import { UserDto } from '../../auth/api/dto.js';
import { AccessErrorFilter, ZodBody, readRequestMeta } from '../../auth/api/http.js';
import { AccountUseCases } from '../application/account.use-cases.js';
import {
  ChangePasswordDto,
  ChangePasswordRequestSchema,
  SessionDto,
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
  constructor(@Inject(AccountUseCases) private readonly account: AccountUseCases) {}

  @Patch('me')
  @ApiBody({ type: UpdateProfileDto })
  @ApiOkResponse({ type: UserDto })
  updateProfile(
    @CurrentUser() user: AuthUser,
    @Body(new ZodBody(UpdateProfileRequestSchema)) body: z.infer<typeof UpdateProfileRequestSchema>,
    @Req() req: Request,
  ) {
    return this.account.updateProfile(user, body, readRequestMeta(req));
  }

  /** Sai mật khẩu hiện tại: 400. Đổi xong thì các thiết bị khác bị đăng xuất, thiết bị này vẫn dùng tiếp. */
  @Post('password/change')
  @HttpCode(HttpStatus.NO_CONTENT)
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
  async logoutAll(@CurrentUser() user: AuthUser, @Req() req: Request): Promise<void> {
    await this.account.logoutAll(user, readRequestMeta(req));
  }
}
