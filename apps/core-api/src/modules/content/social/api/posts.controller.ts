import { SocialErrorFilter } from './social-error.filter.js';
import {
  UseFilters,
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
import { Authenticated, CurrentUser, type AuthUser } from '@tripflix/auth';
import { OptionalAuthenticated, OptionalCurrentUser } from './optional-auth.guard.js';
import {
  DeletedSocialItemDto,
  PublishedPostDto,
  SharedPostDto,
  SocialPostDetailDto,
  SocialPostDto,
  SocialPostPageDto,
} from './dto/response.dto.js';
import {
  CreatePostDto,
  CreatePostSchema,
  ListPostsQueryDto,
  ListPostsQuerySchema,
  ListUserPostsQueryDto,
  ListUserPostsQuerySchema,
  UpdatePostDto,
  UpdatePostSchema,
} from './dto/post.dto.js';
import { ZodBody, ZodQuery } from './http.js';
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
@UseFilters(SocialErrorFilter)
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
  @Authenticated()
  @ApiOperation({ summary: 'Tạo bản nháp bài đăng (FR1)' })
  @ApiResponse({ status: 201, description: 'Bản nháp đã được tạo thành công', type: SocialPostDto })
  async createDraft(
    @CurrentUser() user: AuthUser,
    @Body(new ZodBody(CreatePostSchema)) dto: CreatePostDto,
  ) {
    return this.createDraftUseCase.execute({
      authorId: user.userId,
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
  @ApiResponse({ status: 200, description: 'Danh sách bài đăng kèm nextCursor', type: SocialPostPageDto })
  async listPublicPosts(@Query(new ZodQuery(ListPostsQuerySchema)) query: ListPostsQueryDto) {
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
  @Authenticated()
  @ApiOperation({ summary: 'Lấy danh sách bài đăng và bản nháp của chính mình (FR1)' })
  @ApiResponse({ status: 200, description: 'Danh sách bài của người dùng', type: SocialPostPageDto })
  async listMyPosts(
    @CurrentUser() user: AuthUser,
    @Query(new ZodQuery(ListUserPostsQuerySchema)) query: ListUserPostsQueryDto,
  ) {
    return this.listUserPostsUseCase.execute({
      authorId: user.userId,
      limit: query.limit ? Number(query.limit) : undefined,
      cursor: query.cursor,
      status: query.status,
    });
  }

  @Get('posts/:id')
  @OptionalAuthenticated()
  @ApiOperation({ summary: 'Lấy chi tiết bài đăng theo quyền người xem (FR3, FR4, FR12)' })
  @ApiResponse({
    status: 200,
    description: 'Chi tiết bài đăng kèm lộ trình đã ẩn PII và context',
    type: SocialPostDetailDto,
  })
  async getPostDetail(@Param('id') postId: string, @OptionalCurrentUser() user?: AuthUser) {
    const isStaff = user?.role === 'moderator' || user?.role === 'superadmin';
    return this.getPostDetailUseCase.execute({
      postId,
      viewerId: user?.userId,
      isStaff,
    });
  }

  @Patch('posts/:id')
  @ApiBearerAuth()
  @Authenticated()
  @ApiOperation({ summary: 'Sửa bản nháp hoặc bài đã đăng (FR1, FR5, FR7)' })
  @ApiResponse({ status: 200, description: 'Bài đăng sau khi cập nhật', type: SocialPostDto })
  async updatePost(
    @Param('id') postId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodBody(UpdatePostSchema)) dto: UpdatePostDto,
  ) {
    return this.updatePostUseCase.execute({
      postId,
      userId: user.userId,
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
  @Authenticated()
  @ApiOperation({ summary: 'Xuất bản bản nháp thành bài đăng công khai (FR2, FR3)' })
  @ApiResponse({
    status: 200,
    description: 'Bài đăng đã được xuất bản (kèm shareUrl và dấu xác thực)',
    type: PublishedPostDto,
  })
  @ApiResponse({ status: 201, description: 'Bài đăng đã được xuất bản', type: PublishedPostDto })
  async publishPost(@Param('id') postId: string, @CurrentUser() user: AuthUser) {
    return this.publishPostUseCase.execute({
      postId,
      userId: user.userId,
    });
  }

  @Delete('posts/:id')
  @ApiBearerAuth()
  @Authenticated()
  @ApiOperation({ summary: 'Xóa bài đăng của mình (FR6)' })
  @ApiResponse({ status: 200, description: 'Xóa bài thành công', type: DeletedSocialItemDto })
  async deletePost(@Param('id') postId: string, @CurrentUser() user: AuthUser) {
    const isSuperAdmin = user.role === 'superadmin';
    return this.deletePostUseCase.execute({
      postId,
      userId: user.userId,
      isSuperAdmin,
    });
  }

  @Post('posts/:id/shares')
  @HttpCode(HttpStatus.OK)
  @OptionalAuthenticated()
  @ApiOperation({ summary: 'Ghi nhận lượt chia sẻ bài viết (FR12)' })
  @ApiResponse({ status: 200, description: 'Đã ghi nhận chia sẻ và trả về shareUrl', type: SharedPostDto })
  async trackShare(@Param('id') postId: string, @OptionalCurrentUser() user?: AuthUser) {
    return this.trackShareUseCase.execute({
      postId,
      userId: user?.userId,
    });
  }
}
