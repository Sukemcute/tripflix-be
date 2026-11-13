import {
  BadRequestException, Controller, Delete, Get, HttpCode, NotFoundException,
  Inject, Param, ParseUUIDPipe, Put, Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Authenticated, CurrentUser, ServiceOnly, type AuthUser } from '@tripflix/auth';
import { z } from 'zod';
import { Transactional } from '@tripflix/db';
import { CONTENT_OUTBOX, type ContentOutbox } from '../application/ports/content-outbox.port.js';
import { AccessFacade } from '../../../access/index.js';
import { FollowRepository } from '../infra/follow.repository.js';
import { PostRepository } from '../infra/post.repository.js';

class FollowStatusDto {
  @ApiProperty() isFollowing!: boolean;
}

class PostFollowerPageDto {
  @ApiProperty() isEligible!: boolean;
  @ApiProperty({ required: false, format: 'date-time' }) sharedPublishedAt?: string;
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
    @Inject(CONTENT_OUTBOX) private readonly outbox: ContentOutbox,
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
  @Transactional('content')
  async follow(@Param('authorId', ParseUUIDPipe) authorId: string, @CurrentUser() user: AuthUser) {
    if (authorId.toLowerCase() === user.userId.toLowerCase()) {
      throw new BadRequestException('Bạn không thể theo dõi chính mình.');
    }
    if (!(await this.access.getDisplayNames([authorId.toLowerCase()])).has(authorId.toLowerCase())) {
      throw new NotFoundException('Không tìm thấy người dùng.');
    }
    const row = await this.follows.follow(user.userId, authorId);
    if (row) await this.outbox.add({ type: 'content.follow.changed', payload: {
      followerId: row.followerId, authorId: row.authorId, followedAt: row.followedAt.toISOString(),
    } });
    return { isFollowing: true };
  }

  @Delete('users/:authorId/follow')
  @Authenticated()
  @HttpCode(200)
  @ApiResponse({ status: 200, type: FollowStatusDto })
  @Transactional('content')
  async unfollow(@Param('authorId', ParseUUIDPipe) authorId: string, @CurrentUser() user: AuthUser) {
    const row = await this.follows.unfollow(user.userId, authorId);
    if (row) await this.outbox.add({ type: 'content.follow.changed', payload: {
      followerId: row.followerId, authorId: row.authorId, followedAt: null,
    } });
    return { isFollowing: false };
  }

  @Get('internal/posts/:postId/follower-recipients')
  @ServiceOnly('notification-service')
  @ApiQuery({ name: 'cursor', required: false, schema: { type: 'string', format: 'uuid' } })
  @ApiResponse({ status: 200, type: PostFollowerPageDto })
  @ApiQuery({ name: 'sharedThreshold', required: false, type: Number })
  async listPostRecipients(@Param('postId', ParseUUIDPipe) postId: string, @Query('cursor') cursor?: string,
    @Query('sharedThreshold') rawThreshold?: string) {
    const threshold = rawThreshold === undefined ? undefined : Number(rawThreshold);
    if (threshold !== undefined && (!Number.isSafeInteger(threshold) || threshold < 1 || threshold > 100_000)) {
      throw new BadRequestException('Ngưỡng follower không hợp lệ.');
    }
    if (cursor !== undefined && !z.uuid().safeParse(cursor).success) {
      throw new BadRequestException('Cursor không hợp lệ.');
    }
    const post = await this.posts.findById(postId);
    if (!post || post.deletedAt || post.status !== 'published' || post.visibility !== 'public' || !post.publishedAt) {
      return { isEligible: false, recipients: [], nextCursor: null };
    }
    if (!cursor && threshold && await this.follows.reachesThreshold(post.authorId, threshold)) {
      return { isEligible: true, sharedPublishedAt: post.publishedAt.toISOString(), recipients: [], nextCursor: null };
    }
    return { isEligible: true, ...await this.follows.listEligible(post.authorId, post.publishedAt, cursor) };
  }
}
