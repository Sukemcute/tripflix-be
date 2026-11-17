import { BadRequestException, Body, Controller, HttpCode, HttpStatus, Inject, Post } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OptionalAuthenticated, OptionalCurrentUser, type AuthUser } from '@tripflix/auth';
import { ExploreUseCases } from '../application/explore.use-cases.js';
import { SearchEventsPublisher } from '../application/search-events.publisher.js';
import {
  ExploreRequestDto,
  ExploreRequestSchema,
  ExploreResponseDto,
  SearchPlacesRequestDto,
  SearchPlacesRequestSchema,
  SearchPlacesResponseDto,
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
      '- Gõ có dấu thì tôn trọng dấu (`trứng` ≠ `Trung`). Gõ sai thì tìm cả câu gốc lẫn câu đã sửa rồi gộp kết quả.',
      '- `sections` chỉ gồm mục khớp đủ câu: đúng nơi, không vượt ngân sách, khớp từ. Vùng không có mục nào như vậy thì `total: 0`.',
      '- Vùng câu muốn tìm rỗng: `fallback` là kết quả thay thế sau khi nới điều kiện (`relaxed`: khác nơi, vượt ngân sách, bỏ từ). Không có gì liên quan thì `fallback: null`.',
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
      '- `postType`: `all` (mặc định), `plan`, `video`, `post`, `article`. Video kèm lộ trình thuộc cả `plan` và `video`; với `all` chỉ trả một lần. `article` = `plan` + `post` nhưng bỏ mọi video, lọc ở server nên trang luôn đủ `limit`.',
      '- `sort`: `relevance` (mặc định, liên quan nhất), `trending` (điểm `hot@v2`), `recent` (mới nhất trước). Chỉ đổi thứ tự trong tập kết quả khớp, không đổi `total` hay `isFallback`.',
      '- Mỗi bài có `likes`, `comments`, `createdAt`, `author` để hiện thẻ. Không có trạng thái đã thích/đã lưu của người xem.',
      '- Kết quả chính không bao giờ vượt ngân sách trong câu (chi phí mỗi người của lộ trình). Bài bị ẩn hoặc xoá không trả về.',
      '- Phân trang: gửi `nextCursor` của trang trước vào `cursor`. Không có kết quả thì `items: []`, `total: 0`.',
      '- Không bài nào khớp đủ câu (vd "mùa thu hà nội", lộ trình vượt ngân sách): `isFallback: true`, `items` là kết quả thay thế, `fallbackRelaxed` là điều kiện đã nới, `dropped` là các từ bị bỏ.',
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

  @Post('places')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Tìm một loại chỗ, điểm (khách sạn, điểm tham quan, quán ăn, quán nước) bằng câu tự nhiên, có phân trang',
    description: [
      'Cho các tab riêng của trang tìm web Cảm hứng. Công khai. Cùng bộ hiểu câu và chỉ mục với `POST /api/search`.',
      '',
      '- `kind`: `stay` (khách sạn đặt được, `refId` là mã khách sạn), `see`, `food`, `cafe` (địa điểm ngoài Tripflix từ OpenStreetMap, không đặt được, có `location`).',
      '- Có điểm OpenStreetMap thì `attribution` khác null và phải hiện kèm danh sách.',
      '- Phân trang, `isFallback`, `dropped`, `fallbackRelaxed` như `POST /api/search/posts`.',
    ].join('\n'),
  })
  @ApiBody({ type: SearchPlacesRequestDto })
  @ApiOkResponse({ type: SearchPlacesResponseDto })
  @ApiBadRequestResponse({ description: '`q` rỗng hoặc dài hơn 200 ký tự, `kind`, `cursor`, `limit` sai' })
  async searchPlaces(@Body() body: unknown): Promise<SearchPlacesResponseDto> {
    const parsed = SearchPlacesRequestSchema.safeParse(body);
    if (!parsed.success) throw invalidBody(parsed.error.issues);
    // ponytail: chưa phát discovery.search.performed cho tab chỗ/điểm (enum surface chưa có); thêm khi gợi ý cần tín hiệu này.
    return this.explore.searchPlaces(parsed.data);
  }
}
