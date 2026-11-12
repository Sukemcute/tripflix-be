import { BadRequestException, Body, Controller, HttpCode, HttpStatus, Inject, Post } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OptionalAuthenticated, OptionalCurrentUser, type AuthUser } from '@tripflix/auth';
import { ExploreUseCases } from '../application/explore.use-cases.js';
import { SearchEventsPublisher } from '../application/search-events.publisher.js';
import {
  ExploreRequestDto,
  ExploreRequestSchema,
  ExploreResponseDto,
  SearchPostsRequestDto,
  SearchPostsRequestSchema,
  SearchPostsResponseDto,
} from './dto.js';

function invalidBody(issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>): BadRequestException {
  return new BadRequestException({
    message: 'Dữ liệu gửi lên không hợp lệ',
    errors: issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
  });
}

/**
 * Tìm khám phá của app (kiểu TikTok/Netflix): một ô tìm, kết quả chia theo vùng. Công khai.
 * Đăng nhập tuỳ chọn: có người dùng thì phát discovery.search.performed cho gợi ý (trang đầu, không await).
 */
@ApiTags('discovery')
@Controller('search')
@OptionalAuthenticated()
@ApiBearerAuth()
export class ExploreController {
  constructor(
    @Inject(ExploreUseCases) private readonly explore: ExploreUseCases,
    @Inject(SearchEventsPublisher) private readonly searchEvents: SearchEventsPublisher,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Tìm khám phá bằng câu tự nhiên, kết quả chia theo vùng (Ở đâu, Lộ trình, Bài viết, Video...)',
    description: [
      'Một ô tìm cho app. Công khai, không cần đăng nhập. Chỉ đọc chỉ mục của discovery (dựng lại mỗi 10 phút).',
      '',
      '- Hiểu nơi (`đà lạt`, `sg`), ý muốn (`ks`, `ăn gì`), ngân sách (`dưới 2tr`), số ngày (`3n2đ`), tên riêng, gõ sai nhẹ, không dấu.',
      '- Gõ có dấu thì tôn trọng dấu (`trứng` ≠ `Trung`). Không có gì khớp thì vùng có `total: 0`, không đoán bừa.',
      '- Vùng câu muốn tìm rỗng: `suggest` là các gợi ý khác (bỏ các từ trong `dropped`).',
      '- `loc` chỉ dùng khi câu không nói nơi.',
    ].join('\n'),
  })
  @ApiBody({ type: ExploreRequestDto })
  @ApiOkResponse({ type: ExploreResponseDto })
  @ApiBadRequestResponse({ description: '`q` rỗng hoặc dài hơn 200 ký tự, `loc` sai' })
  async search(@Body() body: unknown, @OptionalCurrentUser() user: AuthUser | undefined): Promise<ExploreResponseDto> {
    const parsed = ExploreRequestSchema.safeParse(body);
    if (!parsed.success) throw invalidBody(parsed.error.issues);
    const page = await this.explore.search(parsed.data);
    if (user) {
      const resultCount = page.sections.reduce((sum, s) => sum + s.total, 0);
      this.searchEvents.searchPerformed(user.userId, { surface: 'explore', understood: page.understood, postType: null, resultCount });
    }
    return page;
  }

  @Post('posts')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Tìm bài (lộ trình, video, bài viết) bằng câu tự nhiên, có phân trang',
    description: [
      'Cho tab tìm bài trên app và web Cảm hứng. Công khai. Cùng bộ hiểu câu và chỉ mục với `POST /api/search`.',
      '',
      '- `postType`: `all` (mặc định), `plan`, `video`, `post`. Video kèm lộ trình thuộc cả `plan` và `video`; với `all` chỉ trả một lần.',
      '- Ngân sách trong câu là lọc cứng theo chi phí mỗi người của lộ trình. Bài bị ẩn hoặc xoá không trả về.',
      '- Phân trang: gửi `nextCursor` của trang trước vào `cursor`. Không có kết quả thì `items: []`, `total: 0`.',
      '- Không bài nào khớp đủ câu nhưng hiểu được nơi hoặc ý muốn (vd "mùa thu hà nội"): `isFallback: true`, `items` là bài theo phần hiểu được, `dropped` là các từ không có trong dữ liệu.',
    ].join('\n'),
  })
  @ApiBody({ type: SearchPostsRequestDto })
  @ApiOkResponse({ type: SearchPostsResponseDto })
  @ApiBadRequestResponse({ description: '`q` rỗng hoặc dài hơn 200 ký tự, `postType`, `cursor`, `limit` sai' })
  async searchPosts(@Body() body: unknown, @OptionalCurrentUser() user: AuthUser | undefined): Promise<SearchPostsResponseDto> {
    const parsed = SearchPostsRequestSchema.safeParse(body);
    if (!parsed.success) throw invalidBody(parsed.error.issues);
    const page = await this.explore.searchPosts(parsed.data);
    // Chỉ trang đầu: lật trang không phải một lượt tìm mới.
    if (user && !parsed.data.cursor) {
      const postType = parsed.data.postType === 'all' ? null : parsed.data.postType;
      this.searchEvents.searchPerformed(user.userId, { surface: 'posts', understood: page.understood, postType, resultCount: page.total });
    }
    return page;
  }
}
