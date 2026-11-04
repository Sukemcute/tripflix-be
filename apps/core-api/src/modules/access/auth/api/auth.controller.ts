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
  loginSchema,
  refreshSchema,
  registerSchema,
} from './dto.js';
import { AccessErrorFilter, ZodBody, requestMeta } from './http.js';

@ApiTags('auth')
@Controller('auth')
@UseFilters(AccessErrorFilter)
export class AuthController {
  constructor(@Inject(AuthUseCases) private readonly auth: AuthUseCases) {}

  @Post('register')
  @ApiBody({ type: RegisterDto })
  @ApiCreatedResponse({ type: UserDto })
  register(@Body(new ZodBody(registerSchema)) body: z.infer<typeof registerSchema>, @Req() req: Request) {
    return this.auth.register(body, requestMeta(req));
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiBody({ type: LoginDto })
  @ApiOkResponse({ type: TokenPairDto })
  login(@Body(new ZodBody(loginSchema)) body: z.infer<typeof loginSchema>, @Req() req: Request) {
    return this.auth.login(body, requestMeta(req));
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiBody({ type: RefreshDto })
  @ApiOkResponse({ type: TokenPairDto })
  refresh(@Body(new ZodBody(refreshSchema)) body: z.infer<typeof refreshSchema>, @Req() req: Request) {
    return this.auth.refresh(body.refreshToken, requestMeta(req));
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Authenticated()
  @ApiBearerAuth()
  async logout(@CurrentUser() user: AuthUser, @Req() req: Request): Promise<void> {
    await this.auth.logout(user, requestMeta(req));
  }

  @Get('me')
  @Authenticated()
  @ApiBearerAuth()
  @ApiOkResponse({ type: UserDto })
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.userId);
  }
}
