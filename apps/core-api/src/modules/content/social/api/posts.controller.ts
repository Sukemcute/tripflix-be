import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type RequestUser } from './decorators/current-user.decorator.js';
import {
  CreatePostDto,
  ListPostsQueryDto,
  ListUserPostsQueryDto,
  UpdatePostDto,
} from './dto/post.dto.js';
import {
  CreateDraftUseCase,
  DeletePostUseCase,
  GetPostDetailUseCase,
  ListPostsUseCase,
  ListUserPostsUseCase,
  PublishPostUseCase,
  TrackShareUseCase,
  UpdatePostUseCase,
} from '../application/index.js';

@ApiTags('Social - Posts')
@Controller('v1')
export class PostsController {
  constructor(
    private readonly createDraftUseCase: CreateDraftUseCase,
    private readonly updatePostUseCase: UpdatePostUseCase,
    private readonly publishPostUseCase: PublishPostUseCase,
    private readonly deletePostUseCase: DeletePostUseCase,
    private readonly getPostDetailUseCase: GetPostDetailUseCase,
    private readonly listPostsUseCase: ListPostsUseCase,
    private readonly listUserPostsUseCase: ListUserPostsUseCase,
    private readonly trackShareUseCase: TrackShareUseCase,
  ) {}

  @Post('posts')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Tạo bản nháp bài đăng (FR1)' })
  @ApiResponse({ status: 201, description: 'Bản nháp đã được tạo thành công' })
  async createDraft(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreatePostDto,
  ) {
    return this.createDraftUseCase.execute({
      authorId: user.id,
      postType: dto.post_type,
      title: dto.title,
      body: dto.body,
      hashtags: dto.hashtags,
      visibility: dto.visibility,
      mediaIds: dto.media_ids,
      coverMediaId: dto.cover_media_id,
      tripAttachment: dto.trip_attachment,
    });
  }

  @Get('posts')
  @ApiOperation({ summary: 'Lấy danh sách bài đăng công khai cho bảng tin và tìm kiếm (FR2, FR4)' })
  @ApiResponse({ status: 200, description: 'Danh sách bài đăng kèm next_cursor' })
  async listPublicPosts(@Query() query: ListPostsQueryDto) {
    return this.listPostsUseCase.execute({
      limit: query.limit ? Number(query.limit) : undefined,
      cursor: query.cursor,
      authorId: query.author_id,
      postType: query.post_type,
      hashtag: query.hashtag,
      keyword: query.keyword,
    });
  }

  @Get('me/posts')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Lấy danh sách bài đăng và bản nháp của chính mình (FR1)' })
  @ApiResponse({ status: 200, description: 'Danh sách bài của người dùng' })
  async listMyPosts(
    @CurrentUser() user: RequestUser,
    @Query() query: ListUserPostsQueryDto,
  ) {
    return this.listUserPostsUseCase.execute({
      authorId: user.id,
      limit: query.limit ? Number(query.limit) : undefined,
      cursor: query.cursor,
      status: query.status,
    });
  }

  @Get('posts/:id')
  @ApiOperation({ summary: 'Lấy chi tiết bài đăng theo quyền người xem (FR3, FR4, FR12)' })
  @ApiResponse({ status: 200, description: 'Chi tiết bài đăng kèm lộ trình đã ẩn PII và context' })
  async getPostDetail(
    @Param('id') postId: string,
    @CurrentUser({ required: false }) user: RequestUser | null,
  ) {
    const isStaff = user?.role === 'moderator' || user?.role === 'superadmin';
    return this.getPostDetailUseCase.execute({
      postId,
      viewerId: user?.id,
      isStaff,
    });
  }

  @Patch('posts/:id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Sửa bản nháp hoặc bài đã đăng (FR1, FR5, FR7)' })
  @ApiResponse({ status: 200, description: 'Bài đăng sau khi cập nhật' })
  async updatePost(
    @Param('id') postId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: UpdatePostDto,
  ) {
    return this.updatePostUseCase.execute({
      postId,
      userId: user.id,
      title: dto.title,
      body: dto.body,
      hashtags: dto.hashtags,
      visibility: dto.visibility,
      mediaIds: dto.media_ids,
      coverMediaId: dto.cover_media_id,
      tripAttachment: dto.trip_attachment,
    });
  }

  @Post('posts/:id/publish')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Xuất bản bản nháp thành bài đăng công khai (FR2, FR3)' })
  @ApiResponse({ status: 200, description: 'Bài đăng đã được xuất bản (kèm share_url và dấu xác thực)' })
  async publishPost(
    @Param('id') postId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.publishPostUseCase.execute({
      postId,
      userId: user.id,
    });
  }

  @Delete('posts/:id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Xóa bài đăng của mình (FR6)' })
  @ApiResponse({ status: 200, description: 'Xóa bài thành công' })
  async deletePost(
    @Param('id') postId: string,
    @CurrentUser() user: RequestUser,
  ) {
    const isSuperAdmin = user.role === 'superadmin';
    return this.deletePostUseCase.execute({
      postId,
      userId: user.id,
      isSuperAdmin,
    });
  }

  @Post('posts/:id/shares')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Ghi nhận lượt chia sẻ bài viết (FR12)' })
  @ApiResponse({ status: 200, description: 'Đã ghi nhận chia sẻ và trả về share_url' })
  async trackShare(
    @Param('id') postId: string,
    @CurrentUser({ required: false }) user: RequestUser | null,
  ) {
    return this.trackShareUseCase.execute({
      postId,
      userId: user?.id,
    });
  }
}
