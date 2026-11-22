import { SocialErrorFilter } from './social-error.filter.js';
import { UseFilters, Body, Controller, Get, Param, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Authenticated, CurrentUser, type AuthUser } from '@tripflix/auth';
import { OptionalAuthenticated, OptionalCurrentUser } from './optional-auth.guard.js';
import { SetReactionDto } from './dto/reaction.dto.js';
import { PostReactionDto, PostStatsDto, UpdatedPostReactionDto } from './dto/response.dto.js';
import { GetMyReactionUseCase, GetPostStatsUseCase, SetReactionUseCase } from '../application/index.js';

@ApiTags('Social - Reactions & Stats')
@Controller('v1/posts/:id')
@UseFilters(SocialErrorFilter)
export class ReactionsController {
  constructor(
    private readonly setReactionUseCase: SetReactionUseCase,
    private readonly getPostStatsUseCase: GetPostStatsUseCase,
    private readonly getMyReactionUseCase: GetMyReactionUseCase,
  ) {}

  @Put('reaction')
  @ApiBearerAuth()
  @Authenticated()
  @ApiOperation({ summary: 'Thêm, đổi hoặc bỏ cảm xúc trên bài đăng (FR10 - Idempotent)' })
  @ApiResponse({ status: 200, description: 'Cập nhật cảm xúc thành công', type: UpdatedPostReactionDto })
  async setReaction(@Param('id') postId: string, @CurrentUser() user: AuthUser, @Body() dto: SetReactionDto) {
    return this.setReactionUseCase.execute({
      postId,
      userId: user.userId,
      type: dto.type,
    });
  }

  @Get('reaction')
  @ApiBearerAuth()
  @Authenticated()
  @ApiOperation({ summary: 'Lấy cảm xúc hiện tại của mình đối với bài đăng (FR10)' })
  @ApiResponse({ status: 200, description: 'Cảm xúc hiện tại của user', type: PostReactionDto })
  async getMyReaction(@Param('id') postId: string, @CurrentUser() user: AuthUser) {
    const result = await this.getMyReactionUseCase.execute({
      postId,
      userId: user.userId,
    });
    return {
      post_id: result.postId,
      type: result.type,
    };
  }

  @Get('stats')
  @OptionalAuthenticated()
  @ApiOperation({ summary: 'Lấy tổng số cảm xúc, bình luận, chia sẻ, lưu (FR10)' })
  @ApiResponse({ status: 200, description: 'Thống kê tương tác thời gian thực', type: PostStatsDto })
  async getStats(@Param('id') postId: string, @OptionalCurrentUser() user?: AuthUser) {
    const isStaff = user?.role === 'superadmin' || user?.role === 'moderator';
    return this.getPostStatsUseCase.execute({ postId, viewerId: user?.userId, isStaff });
  }
}
