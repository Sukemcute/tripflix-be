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
  Post,
  Query,
  Req,
  UseFilters,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles, type AuthUser } from '@tripflix/auth';
import type { Request } from 'express';
import type { z } from 'zod';
import { AuthUseCases } from '../../auth/application/auth.use-cases.js';
import { UserDto } from '../../auth/api/dto.js';
import { EncryptedPasswords } from '../../auth/api/encrypted-passwords.js';
import { AccessErrorFilter, ZodBody, readRequestMeta } from '../../auth/api/http.js';
import { StaffUseCases } from '../application/staff.use-cases.js';
import {
  AdminUserDto,
  AdminUserPageDto,
  CreateUserDto,
  CreateUserRequestSchema,
  GrantStaffDto,
  GrantStaffRequestSchema,
  SearchUsersQuerySchema,
} from './dto.js';

const USER_ID_PIPE = new ParseUUIDPipe({ exceptionFactory: () => new BadRequestException('Mã người dùng không hợp lệ') });

/** API của trang quản trị (Back Office). Mọi đường dẫn /admin/* chỉ cho nhân viên. */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin')
@UseFilters(AccessErrorFilter)
@Roles('moderator', 'superadmin')
export class AdminController {
  constructor(
    @Inject(AuthUseCases) private readonly auth: AuthUseCases,
    @Inject(StaffUseCases) private readonly staff: StaffUseCases,
  ) {}

  /** Trang quản trị gọi để biết người đang đăng nhập có phải nhân viên không. */
  @Get('me')
  @ApiOkResponse({ type: UserDto })
  getMe(@CurrentUser() user: AuthUser) {
    return this.auth.getMe(user.userId);
  }

  @Get('staff')
  @Roles('superadmin')
  @ApiOkResponse({ type: UserDto, isArray: true })
  listStaff() {
    return this.staff.listStaff();
  }

  /** Tìm người dùng; moderator thấy email đã che. */
  @Get('users')
  @ApiQuery({ name: 'query', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiOkResponse({ type: AdminUserPageDto })
  searchUsers(
    @CurrentUser() actor: AuthUser,
    @Query(new ZodBody(SearchUsersQuerySchema)) query: z.infer<typeof SearchUsersQuerySchema>,
  ) {
    return this.staff.searchUsers(actor, query);
  }

  /** Tạo tài khoản nhân sự mới (chỉ superadmin). */
  @Post('users')
  @HttpCode(HttpStatus.CREATED)
  @Roles('superadmin')
  @EncryptedPasswords({
    subjectField: 'email',
    fields: [{ encrypted: 'encPassword', plain: 'password', purpose: 'staff_create' }],
  })
  @ApiBody({ type: CreateUserDto })
  @ApiOkResponse({ type: AdminUserDto })
  createStaff(
    @CurrentUser() actor: AuthUser,
    @Body(new ZodBody(CreateUserRequestSchema)) body: z.infer<typeof CreateUserRequestSchema>,
    @Req() req: Request,
  ) {
    return this.staff.createStaff(actor, body, readRequestMeta(req));
  }

  /** Cấp quyền kiểm duyệt viên. Mọi phiên của người đó bị thu hồi để token mang role mới. */
  @Post('staff')
  @HttpCode(HttpStatus.OK)
  @Roles('superadmin')
  @ApiBody({ type: GrantStaffDto })
  @ApiOkResponse({ type: AdminUserDto })
  grantModerator(
    @CurrentUser() actor: AuthUser,
    @Body(new ZodBody(GrantStaffRequestSchema)) body: z.infer<typeof GrantStaffRequestSchema>,
    @Req() req: Request,
  ) {
    return this.staff.grantModerator(actor, body.userId, readRequestMeta(req));
  }

  /** Thu hồi quyền kiểm duyệt viên, về member. */
  @Delete('staff/:userId')
  @Roles('superadmin')
  @ApiOkResponse({ type: AdminUserDto })
  revokeModerator(
    @CurrentUser() actor: AuthUser,
    @Param('userId', USER_ID_PIPE) userId: string,
    @Req() req: Request,
  ) {
    return this.staff.revokeModerator(actor, userId, readRequestMeta(req));
  }

  /** Khoá tài khoản: không đăng nhập được, mọi phiên bị thu hồi ngay. */
  @Post('users/:userId/lock')
  @HttpCode(HttpStatus.OK)
  @Roles('superadmin')
  @ApiOkResponse({ type: AdminUserDto })
  lock(@CurrentUser() actor: AuthUser, @Param('userId', USER_ID_PIPE) userId: string, @Req() req: Request) {
    return this.staff.lock(actor, userId, readRequestMeta(req));
  }

  @Post('users/:userId/unlock')
  @HttpCode(HttpStatus.OK)
  @Roles('superadmin')
  @ApiOkResponse({ type: AdminUserDto })
  unlock(@CurrentUser() actor: AuthUser, @Param('userId', USER_ID_PIPE) userId: string, @Req() req: Request) {
    return this.staff.unlock(actor, userId, readRequestMeta(req));
  }
}
