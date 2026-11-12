import {
  BadRequestException, Controller, Delete, Get, HttpCode, NotFoundException,
  Param, ParseUUIDPipe, Put, Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Authenticated, CurrentUser, ServiceOnly, type AuthUser } from '@tripflix/auth';
import { z } from 'zod';
import { AccessFacade } from '../../../access/index.js';
import { FollowRepository } from '../infra/follow.repository.js';
import { PostRepository } from '../infra/post.repository.js';

class FollowStatusDto {
  @ApiProperty() isFollowing!: boolean;
}

class PostFollowerPageDto {
  @ApiProperty() isEligible!: boolean;
  @ApiProperty({ type: [String], format: 'uuid' }) recipients!: string[];
  @ApiProperty({ type: String, nullable: true, format: 'uuid' }) nextCursor!: string | null;
}

@ApiTags('Social - Follows')
@ApiBearerAuth()
@Controller('v1')
export class FollowsController {
  constructor(
    private readonly follows: FollowRepository,
    private readonly access: AccessFacade,
    private readonly posts: PostRepository,
  ) {}

  @Get('users/:authorId/follow')
  @Authenticated()
  @ApiResponse({ status: 200, type: FollowStatusDto })
  async getStatus(@Param('authorId', ParseUUIDPipe) authorId: string, @CurrentUser() user: AuthUser) {
    return { isFollowing: await this.follows.isFollowing(user.userId, authorId) };
  }

  @Put('users/:authorId/follow')
  @Authenticated()
  @ApiResponse({ status: 200, type: FollowStatusDto })
  async follow(@Param('authorId', ParseUUIDPipe) authorId: string, @CurrentUser() user: AuthUser) {
    if (authorId.toLowerCase() === user.userId.toLowerCase()) {
      throw new BadRequestException('Bạn không thể theo dõi chính mình.');
    }
    if (!(await this.access.getDisplayNames([authorId.toLowerCase()])).has(authorId.toLowerCase())) {
      throw new NotFoundException('Không tìm thấy người dùng.');
    }
    await this.follows.follow(user.userId, authorId);
    return { isFollowing: true };
  }

  @Delete('users/:authorId/follow')
  @Authenticated()
  @HttpCode(200)
  @ApiResponse({ status: 200, type: FollowStatusDto })
  async unfollow(@Param('authorId', ParseUUIDPipe) authorId: string, @CurrentUser() user: AuthUser) {
    await this.follows.unfollow(user.userId, authorId);
    return { isFollowing: false };
  }

  @Get('internal/posts/:postId/follower-recipients')
  @ServiceOnly('notification-service')
  @ApiQuery({ name: 'cursor', required: false, schema: { type: 'string', format: 'uuid' } })
  @ApiResponse({ status: 200, type: PostFollowerPageDto })
  async listPostRecipients(@Param('postId', ParseUUIDPipe) postId: string, @Query('cursor') cursor?: string) {
    if (cursor !== undefined && !z.uuid().safeParse(cursor).success) {
      throw new BadRequestException('Cursor không hợp lệ.');
    }
    const post = await this.posts.findById(postId);
    if (!post || post.deletedAt || post.status !== 'published' || post.visibility !== 'public' || !post.publishedAt) {
      return { isEligible: false, recipients: [], nextCursor: null };
    }
    return { isEligible: true, ...await this.follows.listEligible(post.authorId, post.publishedAt, cursor) };
  }
}
