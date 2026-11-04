import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Post, Req, UseFilters } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiCreatedResponse, ApiTags } from '@nestjs/swagger';
import { Authenticated, CurrentUser, type AuthUser } from '@tripflix/auth';
import type { Request } from 'express';
import type { z } from 'zod';
import { AuthUseCases } from '../application/auth.use-cases.js';
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

@ApiTags('auth')
@Controller('auth')
@UseFilters(AccessErrorFilter)
export class AuthController {
  constructor(@Inject(AuthUseCases) private readonly auth: AuthUseCases) {}

  @Post('register')
  @ApiBody({ type: RegisterDto })
  @ApiCreatedResponse({ type: UserDto })
  register(@Body(new ZodBody(RegisterRequestSchema)) body: z.infer<typeof RegisterRequestSchema>, @Req() req: Request) {
    return this.auth.register(body, readRequestMeta(req));
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiBody({ type: LoginDto })
  @ApiOkResponse({ type: TokenPairDto })
  login(@Body(new ZodBody(LoginRequestSchema)) body: z.infer<typeof LoginRequestSchema>, @Req() req: Request) {
    return this.auth.login(body, readRequestMeta(req));
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiBody({ type: RefreshDto })
  @ApiOkResponse({ type: TokenPairDto })
  refresh(@Body(new ZodBody(RefreshRequestSchema)) body: z.infer<typeof RefreshRequestSchema>, @Req() req: Request) {
    return this.auth.refresh(body.refreshToken, readRequestMeta(req));
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Authenticated()
  @ApiBearerAuth()
  async logout(@CurrentUser() user: AuthUser, @Req() req: Request): Promise<void> {
    await this.auth.logout(user, readRequestMeta(req));
  }

  @Get('me')
  @Authenticated()
  @ApiBearerAuth()
  @ApiOkResponse({ type: UserDto })
  getMe(@CurrentUser() user: AuthUser) {
    return this.auth.getMe(user.userId);
  }
}
