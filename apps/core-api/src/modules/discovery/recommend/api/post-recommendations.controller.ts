import { BadRequestException, Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiOkResponse, ApiOperation, ApiProperty, ApiQuery, ApiTags } from '@nestjs/swagger';
import { OptionalAuthenticated, OptionalCurrentUser, type AuthUser } from '@tripflix/auth';
import { z } from 'zod';
import { InvalidRecommendCursorError, PostRecommendationUseCases } from '../application/post-recommendations.use-cases.js';

export const PostRecommendationQuerySchema = z.object({
  mode: z.enum(['for_you', 'trending']).default('for_you'),
  postType: z.enum(['video', 'vlog']).optional(),
  limit: z.coerce.number().int().min(1).max(20).default(20),
  cursor: z.string().max(512).optional(),
});

export class RecommendedPostDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: ['video', 'vlog'] }) postType!: string;
  @ApiProperty({ example: 'Săn mây Đà Lạt' }) title!: string;
  @ApiProperty({ type: [String], example: ['dalat'] }) hashtags!: string[];
  @ApiProperty({ type: String, nullable: true }) coverMediaId!: string | null;
  @ApiProperty({ format: 'uuid' }) authorId!: string;
  @ApiProperty({ example: 120 }) reactionTotal!: number;
}

export class RecommendReasonDto {
  @ApiProperty({ enum: ['matches_place', 'matches_interest', 'trending', 'explore'] }) code!: string;
  @ApiProperty({ example: 'Vì bạn quan tâm Đà Lạt', description: 'Câu hiện dưới thẻ, tiếng Việt' }) text!: string;
}

export class PostRecommendationItemDto {
  @ApiProperty({ type: RecommendedPostDto }) post!: RecommendedPostDto;
  @ApiProperty({ enum: ['hot', 'taste', 'fresh', 'explore'], description: 'Nguồn ứng viên: hot (điểm nóng), fresh (đăng trong 48 giờ), explore (~5% ngẫu nhiên để đo)' })
  source!: string;
  @ApiProperty({ type: RecommendReasonDto }) reason!: RecommendReasonDto;
}

export class PostRecommendationsDto {
  @ApiProperty({ type: [PostRecommendationItemDto] }) items!: PostRecommendationItemDto[];
  @ApiProperty({ example: 'for_you', description: 'Thuật toán đã dùng (khách hoặc cấu hình lỗi thì là trending)' }) algo!: string;
  @ApiProperty({ type: String, nullable: true, description: 'Gửi lại ở `cursor` để lấy trang sau; null là hết' }) nextCursor!: string | null;
}

/** Gợi ý bài viết (video/vlog) theo gu người dùng hoặc thịnh hành. Đăng nhập tuỳ chọn. */
@ApiTags('discovery')
@Controller('recommendations')
export class PostRecommendationsController {
  constructor(@Inject(PostRecommendationUseCases) private readonly recommendations: PostRecommendationUseCases) {}

  @Get('posts')
  @OptionalAuthenticated()
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Gợi ý bài viết cho bạn hoặc đang thịnh hành',
    description: [
      'Đăng nhập tuỳ chọn. Gu người dùng tính lại mỗi 10 phút từ cảm xúc, bình luận, chia sẻ, đơn, lượt tìm.',
      '',
      '- `for_you`: theo gu; khách (không token) nhận `trending`, xem trường `algo`.',
      '- Không trả bài đã tương tác. Người đăng nhập: không trả lại bài đã gợi ý trong 48 giờ (tối đa 100 bài); hết ứng viên thì trả ít hơn hoặc rỗng.',
      '- Phân trang: gửi `nextCursor` của trang trước vào `cursor`; trang sau dùng cùng thuật toán với trang đầu.',
      '- Khoảng 5% vị trí là bài ngẫu nhiên (`source: explore`) để đo chất lượng gợi ý.',
    ].join('\n'),
  })
  @ApiQuery({ name: 'mode', required: false, enum: ['for_you', 'trending'] })
  @ApiQuery({ name: 'postType', required: false, enum: ['video', 'vlog'] })
  @ApiQuery({ name: 'limit', required: false, example: 20, description: '1–20, mặc định 20' })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiBadRequestResponse({ description: 'Tham số sai hoặc `cursor` không do server cấp' })
  @ApiOkResponse({ type: PostRecommendationsDto })
  async recommendPosts(@Query() query: Record<string, unknown>, @OptionalCurrentUser() user: AuthUser | undefined): Promise<PostRecommendationsDto> {
    const parsed = PostRecommendationQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Tham số không hợp lệ',
        errors: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      });
    }
    try {
      return await this.recommendations.recommend({
        mode: parsed.data.mode,
        postType: parsed.data.postType ?? null,
        limit: parsed.data.limit,
        cursor: parsed.data.cursor ?? null,
        userId: user?.userId ?? null,
      });
    } catch (error) {
      if (error instanceof InvalidRecommendCursorError) {
        throw new BadRequestException({ message: 'Tham số không hợp lệ', errors: [{ field: 'cursor', message: error.message }] });
      }
      throw error;
    }
  }
}
