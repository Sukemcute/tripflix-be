import {
  Body,
  Controller,
  Get,
  Param,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type RequestUser } from './decorators/current-user.decorator.js';
import { SetReactionDto } from './dto/reaction.dto.js';
import {
  GetPostStatsUseCase,
  SetReactionUseCase,
} from '../application/index.js';
import { ReactionRepository } from '../infra/reaction.repository.js';
import type { ReactionType } from '../../db/schema/index.js';

@ApiTags('Social - Reactions & Stats')
@Controller('v1/posts/:id')
export class ReactionsController {
  constructor(
    private readonly setReactionUseCase: SetReactionUseCase,
    private readonly getPostStatsUseCase: GetPostStatsUseCase,
    private readonly reactionRepository: ReactionRepository,
  ) {}

  @Put('reaction')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Thêm, đổi hoặc bỏ cảm xúc trên bài đăng (FR10 - Idempotent)' })
  @ApiResponse({ status: 200, description: 'Cập nhật cảm xúc thành công' })
  async setReaction(
    @Param('id') postId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: SetReactionDto,
  ) {
    return this.setReactionUseCase.execute({
      postId,
      userId: user.id,
      type: dto.type,
    });
  }

  @Get('reaction')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Lấy cảm xúc hiện tại của mình đối với bài đăng (FR10)' })
  @ApiResponse({ status: 200, description: 'Cảm xúc hiện tại của user' })
  async getMyReaction(
    @Param('id') postId: string,
    @CurrentUser() user: RequestUser,
  ) {
    const reaction = await this.reactionRepository.findByPostAndUser(postId, user.id);
    return {
      post_id: postId,
      type: (reaction?.type as ReactionType) ?? null,
    };
  }

  @Get('stats')
  @ApiOperation({ summary: 'Lấy tổng số cảm xúc, bình luận, chia sẻ, lưu (FR10)' })
  @ApiResponse({ status: 200, description: 'Thống kê tương tác thời gian thực' })
  async getStats(@Param('id') postId: string) {
    return this.getPostStatsUseCase.execute({ postId });
  }
}
