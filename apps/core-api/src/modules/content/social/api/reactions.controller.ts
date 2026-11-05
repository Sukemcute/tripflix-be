import {
  Body,
  Controller,
  Get,
  Param,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Authenticated, CurrentUser, type AuthUser } from '@tripflix/auth';
import { SetReactionDto } from './dto/reaction.dto.js';
import {
  GetMyReactionUseCase,
  GetPostStatsUseCase,
  SetReactionUseCase,
} from '../application/index.js';

@ApiTags('Social - Reactions & Stats')
@Controller('v1/posts/:id')
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
  @ApiResponse({ status: 200, description: 'Cập nhật cảm xúc thành công' })
  async setReaction(
    @Param('id') postId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: SetReactionDto,
  ) {
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
  @ApiResponse({ status: 200, description: 'Cảm xúc hiện tại của user' })
  async getMyReaction(
    @Param('id') postId: string,
    @CurrentUser() user: AuthUser,
  ) {
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
  @ApiOperation({ summary: 'Lấy tổng số cảm xúc, bình luận, chia sẻ, lưu (FR10)' })
  @ApiResponse({ status: 200, description: 'Thống kê tương tác thời gian thực' })
  async getStats(@Param('id') postId: string) {
    return this.getPostStatsUseCase.execute({ postId });
  }
}
