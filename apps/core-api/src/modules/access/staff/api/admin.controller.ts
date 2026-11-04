import { Controller, Get, Inject, UseFilters } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles, type AuthUser } from '@tripflix/auth';
import { AuthUseCases } from '../../auth/application/auth.use-cases.js';
import { UserDto } from '../../auth/api/dto.js';
import { AccessErrorFilter } from '../../auth/api/http.js';
import { StaffUseCases } from '../application/staff.use-cases.js';

/** API của trang quản trị. Mọi đường dẫn /admin/* chỉ cho nhân viên. */
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
}
