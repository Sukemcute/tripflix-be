import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type RequestUser } from './decorators/current-user.decorator.js';
import { AdminPostQueryDto, CreateModerationActionDto } from './dto/moderation.dto.js';
import { decodeCursor, encodeCursor } from '../application/common/cursor.js';
import { AdminModeratePostUseCase } from '../application/use-cases/admin-moderate-post.use-case.js';
import { ModerationActionRepository } from '../infra/moderation-action.repository.js';
import { PostRepository } from '../infra/post.repository.js';

@ApiTags('Social - Admin Moderation')
@Controller('v1')
export class AdminPostsController {
  constructor(
    private readonly postRepo: PostRepository,
    private readonly moderationRepo: ModerationActionRepository,
    private readonly adminModeratePostUseCase: AdminModeratePostUseCase,
  ) {}

  @Get('admin/posts')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Danh sách bài đăng trong trang quản trị (FR13)' })
  @ApiResponse({ status: 200, description: 'Danh sách bài đăng và tổng số' })
  async listAdminPosts(
    @CurrentUser() user: RequestUser,
    @Query() query: AdminPostQueryDto,
  ) {
    this.assertModerator(user);
    const limit = query.limit ? Math.min(Math.max(Number(query.limit), 1), 100) : 20;
    const cursorObj = decodeCursor(query.cursor);

    const posts = await this.postRepo.findAdminPosts({
      limit: limit + 1,
      cursorCreatedAt: cursorObj?.createdAt,
      cursorId: cursorObj?.id,
      status: query.status,
      authorId: query.author_id,
    });

    const hasMore = posts.length > limit;
    const items = hasMore ? posts.slice(0, limit) : posts;
    const lastItem = items[items.length - 1];
    const nextCursor =
      hasMore && lastItem ? encodeCursor(lastItem.createdAt, lastItem.id) : null;

    const total = await this.postRepo.countAdminPosts({
      status: query.status,
      authorId: query.author_id,
    });

    return {
      items: items.map((p) => ({
        id: p.id,
        author: { id: p.authorId, display_name: `User ${p.authorId.slice(0, 8)}` },
        title: p.title,
        post_type: p.postType,
        status: p.status,
        visibility: p.visibility,
        report_count: 0,
        reaction_total: p.reactionTotal,
        comment_count: p.commentCount,
        created_at: p.createdAt.toISOString(),
      })),
      next_cursor: nextCursor,
      total,
    };
  }

  @Get('admin/posts/:id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Chi tiết bài đăng kèm lịch sử kiểm duyệt (FR13)' })
  @ApiResponse({ status: 200, description: 'Chi tiết bài đăng và lịch sử kiểm duyệt' })
  async getAdminPostDetail(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
  ) {
    this.assertModerator(user);
    const post = await this.postRepo.findById(id);
    if (!post) {
      throw new NotFoundException(`Không tìm thấy bài viết với ID ${id}`);
    }

    const history = await this.moderationRepo.findByPostId(id);

    return {
      id: post.id,
      title: post.title,
      body: post.body,
      post_type: post.postType,
      status: post.status,
      visibility: post.visibility,
      is_verified: post.isVerified,
      author: { id: post.authorId, display_name: `User ${post.authorId.slice(0, 8)}` },
      media_ids: post.mediaIds,
      cover_media_id: post.coverMediaId,
      hashtags: post.hashtags,
      trip_attachment: post.tripAttachment,
      reaction_counts: post.reactionCounts,
      reaction_total: post.reactionTotal,
      comment_count: post.commentCount,
      share_count: post.shareCount,
      bookmark_count: post.bookmarkCount,
      created_at: post.createdAt.toISOString(),
      updated_at: post.updatedAt.toISOString(),
      moderation_history: history.map((h) => ({
        action_id: h.id,
        action: h.action,
        reason_code: h.reasonCode,
        reason_detail: h.reasonDetail,
        report_ids: h.reportIds,
        moderator_id: h.moderatorId,
        created_at: h.createdAt.toISOString(),
      })),
    };
  }

  @Post('admin/posts/:id/moderation-actions')
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Xử lý kiểm duyệt bài viết (FR13)' })
  @ApiResponse({ status: 201, description: 'Ghi nhận hành động kiểm duyệt thành công' })
  async moderatePost(
    @CurrentUser() user: RequestUser,
    @Param('id') postId: string,
    @Body() dto: CreateModerationActionDto,
  ) {
    this.assertModerator(user);
    return this.adminModeratePostUseCase.execute({
      postId,
      moderatorId: user.id,
      action: dto.action,
      reasonCode: dto.reason_code,
      reasonDetail: dto.reason_detail,
      reportIds: dto.report_ids,
    });
  }

  private assertModerator(user: RequestUser): void {
    const role = user.role?.toLowerCase();
    if (!role || !['moderator', 'superadmin', 'admin'].includes(role)) {
      throw new ForbiddenException('Bạn không có quyền thực hiện thao tác quản trị');
    }
  }
}
