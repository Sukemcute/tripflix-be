import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';
import { STAY_SORTS, type StaySort } from '../domain/stays.js';
import { POST_TYPES, type PostType } from '../application/explore.use-cases.js';
import { SUGGEST_TYPES, type SuggestType } from '../domain/suggest-entity.js';

// Schema zod để kiểm query; class bên dưới chỉ để Swagger sinh contracts/openapi.
export const SuggestQuerySchema = z.object({
  q: z.string().trim().min(2, 'Nhập ít nhất 2 ký tự').max(100),
  // "place,hotel": bỏ trống thì lấy cả ba loại.
  types: z
    .string()
    .optional()
    .transform((raw) => (raw ? raw.split(',').map((t) => t.trim()) : [...SUGGEST_TYPES]))
    .pipe(z.array(z.enum(SUGGEST_TYPES as [SuggestType, ...SuggestType[]])).min(1)),
});

export class SuggestionDto {
  @ApiProperty({ example: 'place:da-lat', description: '`<type>:<refId>`, duy nhất trong danh sách' }) id!: string;
  @ApiProperty({ enum: SUGGEST_TYPES, description: 'place: tỉnh hoặc điểm đến · hotel: khách sạn · airport: sân bay' })
  type!: SuggestType;
  @ApiProperty({
    example: 'da-lat',
    description: 'place: placeId để gọi /stays · hotel: mã khách sạn của commerce · airport: mã IATA',
  })
  refId!: string;
  @ApiProperty({ example: 'Đà Lạt', description: 'Tên hiện ở dòng chính' }) name!: string;
  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Lâm Đồng',
    description: 'Dòng phụ: tỉnh cha của điểm đến, nơi của khách sạn, "mã · nơi" của sân bay; tỉnh thì null',
  })
  subtitle!: string | null;
  @ApiProperty({ type: String, nullable: true, example: 'da-lat', description: 'Địa điểm chứa dòng này' })
  placeId!: string | null;
}

export class SuggestResponseDto {
  @ApiProperty({ type: [SuggestionDto], description: 'Đã xếp theo mức khớp; rỗng khi không khớp gì' })
  items!: SuggestionDto[];
}

const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày dạng YYYY-MM-DD');
const OptionalIntSchema = (min: number, max: number) => z.coerce.number().int().min(min).max(max).optional();

export const ListStaysQuerySchema = z
  .object({
    placeId: z.string().trim().min(1, 'Chọn nơi ở'),
    checkIn: IsoDateSchema,
    checkOut: IsoDateSchema,
    adults: z.coerce.number().int().min(1),
    rooms: OptionalIntSchema(1, 99),
    minStars: OptionalIntSchema(1, 5),
    stars: OptionalIntSchema(1, 5),
    priceMin: OptionalIntSchema(0, Number.MAX_SAFE_INTEGER),
    priceMax: OptionalIntSchema(0, Number.MAX_SAFE_INTEGER),
    sort: z.enum(STAY_SORTS as [StaySort, ...StaySort[]]).default('price'),
    cursor: z.string().regex(/^\d+$/, 'cursor lấy từ nextCursor của trang trước').optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .refine((q) => q.checkOut > q.checkIn, { path: ['checkOut'], message: 'Ngày trả phòng phải sau ngày nhận phòng' })
  .refine((q) => q.priceMin === undefined || q.priceMax === undefined || q.priceMin <= q.priceMax, {
    path: ['priceMax'],
    message: 'priceMax phải lớn hơn hoặc bằng priceMin',
  });

class StayProvinceDto {
  @ApiProperty({ example: 'da-lat' }) slug!: string;
  @ApiProperty({ example: 'Đà Lạt' }) name!: string;
}

export class StayDto {
  @ApiProperty({ example: 'P-h-dl-01', description: 'Mã khách sạn của commerce; mở trang chi tiết bằng mã này' }) hotelId!: string;
  @ApiProperty({ example: 'Ana Mandara Villas Đà Lạt' }) name!: string;
  @ApiProperty({ type: Number, nullable: true, example: 5 }) stars!: number | null;
  @ApiProperty({ type: String, nullable: true, example: '/images/vinpearl/vp-luxury-nha-trang-1.jpg' }) thumbnail!: string | null;
  @ApiProperty({ type: StayProvinceDto, description: 'Nơi của khách sạn (tỉnh hoặc điểm đến)' }) province!: StayProvinceDto;
  @ApiProperty({ example: 1_200_000, description: 'Giá thật một đêm một phòng (VND), gói giá mặc định, cho đúng ngày đã chọn' })
  unitPrice!: number;
  @ApiProperty({ example: 2_400_000, description: 'Tổng tiền cả kỳ ở, mọi phòng (VND)' }) totalPrice!: number;
  @ApiProperty({ type: () => StayRatingDto, nullable: true, description: 'Điểm đánh giá của khách; null khi khách sạn chưa có đánh giá' })
  rating!: StayRatingDto | null;
}

class StayRatingDto {
  @ApiProperty({ example: 4.5, description: 'Điểm trung bình, thang 1–5' }) average!: number;
  @ApiProperty({ example: 77, description: 'Số đánh giá' }) count!: number;
}

export class StayPageDto {
  @ApiProperty({ type: [StayDto], description: 'Chỉ khách sạn còn phòng cho ngày và số khách đã chọn, đã lọc và sắp' })
  items!: StayDto[];
  @ApiProperty({ example: 12, description: 'Số khách sạn khớp trên mọi trang' }) total!: number;
  @ApiProperty({ type: String, nullable: true, example: '20', description: 'Gửi lại ở `cursor` để lấy trang sau; null là hết' })
  nextCursor!: string | null;
}

// ---------------- POST /api/search (tìm khám phá trên app)

export const ExploreRequestSchema = z.object({
  q: z.string().trim().min(1, 'Nhập điều muốn tìm').max(200),
  loc: z
    .object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })
    .nullish(),
});

class ExploreLocationDto {
  @ApiProperty({ example: 10.7769 }) lat!: number;
  @ApiProperty({ example: 106.7009 }) lng!: number;
}

export class ExploreRequestDto {
  @ApiProperty({ example: 'cafe chill đà lạt', description: 'Câu người dùng gõ, có dấu hay không đều được (1–200 ký tự)' }) q!: string;
  @ApiProperty({
    type: ExploreLocationDto,
    required: false,
    nullable: true,
    description: 'Vị trí người dùng. Chỉ dùng khi câu không nói nơi: chỗ gần người dùng được xếp lên',
  })
  loc?: ExploreLocationDto | null;
}

export class ExploreItemDto {
  @ApiProperty({ example: 'hotel:P-h-dl-01', description: '`<loại>:<mã gốc>`, duy nhất' }) id!: string;
  @ApiProperty({ example: 'stay', description: 'stay · plan · post · video (food, cafe, see khi có nguồn dữ liệu)' }) kind!: string;
  @ApiProperty({ example: 'P-h-dl-01', description: 'stay: mã khách sạn của commerce · plan/post/video: mã bài' }) refId!: string;
  @ApiProperty({ example: 'Ana Mandara Villas Đà Lạt' }) title!: string;
  @ApiProperty({ type: String, nullable: true, example: 'Đà Lạt', description: 'Nơi của mục' }) subtitle!: string | null;
  @ApiProperty({ type: String, nullable: true }) thumbnail!: string | null;
  @ApiProperty({ example: 'Khớp: chill · Ở Đà Lạt · 5 sao · ~1200k/đêm', description: 'Lý do hiện mục này' }) reason!: string;
  @ApiProperty({ type: Number, nullable: true, description: 'stay: giá từ / đêm · plan: chi phí ước tính / người (VND)' })
  priceFrom!: number | null;
  @ApiProperty({ type: Number, nullable: true, description: 'Số ngày của lộ trình' }) days!: number | null;
  @ApiProperty({ type: ExploreLocationDto, nullable: true }) location!: ExploreLocationDto | null;
}

class ExploreSuggestItemDto extends ExploreItemDto {
  @ApiProperty({ example: 'Ở đâu', description: 'Tên vùng của mục gợi ý' }) section!: string;
}

const RELAX_VALUES = ['place', 'budget', 'terms'] as const;
const RELAX_DESCRIPTION = 'Điều kiện đã nới: place = khác nơi (cách nơi hỏi quá 40 km), budget = vượt ngân sách, terms = không khớp đủ từ trong câu';

class ExploreFallbackItemDto extends ExploreSuggestItemDto {
  @ApiProperty({ enum: RELAX_VALUES, isArray: true, example: ['budget'], description: RELAX_DESCRIPTION }) relaxed!: Array<(typeof RELAX_VALUES)[number]>;
}

class ExploreFallbackDto {
  @ApiProperty({ example: 'resort phú quốc dưới 300k', description: 'Câu người dùng gõ: FE hiện "Kết quả thay thế cho “…”"' }) forQuery!: string;
  @ApiProperty({ enum: RELAX_VALUES, isArray: true, example: ['budget'], description: `Gộp trên các mục. ${RELAX_DESCRIPTION}` })
  relaxed!: Array<(typeof RELAX_VALUES)[number]>;
  @ApiProperty({ type: [String], example: ['dịp', 'lễ'], description: 'Từ trong câu mà các mục thay thế không khớp (dạng người dùng gõ)' }) dropped!: string[];
  @ApiProperty({ type: [ExploreFallbackItemDto], description: 'Mục gần nhất sau khi nới điều kiện, theo vùng câu muốn' }) items!: ExploreFallbackItemDto[];
}

export class ExploreSectionDto {
  @ApiProperty({ example: 'stay', description: 'food · cafe · see · stay · plan · post · video' }) kind!: string;
  @ApiProperty({ example: 'Ở đâu' }) label!: string;
  @ApiProperty({ example: 12, description: 'Số mục khớp; 0 = vùng không có kết quả phù hợp' }) total!: number;
  @ApiProperty({ type: [ExploreItemDto], description: 'Tối đa 6 mục (3 nếu không phải vùng câu nhắm tới)' }) items!: ExploreItemDto[];
}

class ExploreUnderstoodDto {
  @ApiProperty({ type: String, nullable: true, example: 'Đà Lạt' }) place!: string | null;
  @ApiProperty({ type: [String], example: ['cafe'], description: 'Vùng câu nhắm tới, theo thứ tự trong câu' }) intents!: string[];
  @ApiProperty({ type: Number, nullable: true, example: 2_000_000, description: 'Ngân sách (VND)' }) budget!: number | null;
  @ApiProperty({ type: Number, nullable: true, example: 3 }) days!: number | null;
  @ApiProperty({ type: [String], description: 'Tên riêng (đường, chuỗi cửa hàng) phải khớp nguyên cụm' }) names!: string[];
  @ApiProperty({ type: [String], description: 'Cụm từ dính (mì quảng, cao lầu)' }) phrases!: string[];
  @ApiProperty({ type: 'object', additionalProperties: { type: 'string' }, example: { trug: 'trung' }, description: 'Từ đã sửa lỗi gõ' })
  fixed!: Record<string, string>;
}

export class ExploreResponseDto {
  @ApiProperty({ type: ExploreUnderstoodDto, description: 'Máy hiểu câu thế nào (hiện dạng chip)' }) understood!: ExploreUnderstoodDto;
  @ApiProperty({ description: 'true = đã xếp theo vị trí người dùng (câu không nói nơi)' }) nearUser!: boolean;
  @ApiProperty({ type: [ExploreSectionDto], description: 'Vùng câu nhắm tới đứng đầu, vùng rỗng xuống cuối' }) sections!: ExploreSectionDto[];
  @ApiProperty({
    type: ExploreFallbackDto,
    nullable: true,
    description:
      'Kết quả thay thế: vùng câu muốn không có mục nào khớp đủ câu (đúng nơi, không vượt ngân sách, khớp từ) nên nới điều kiện. null nếu có kết quả chính hoặc không có gì liên quan',
  })
  fallback!: ExploreFallbackDto | null;
  @ApiProperty({ type: [ExploreSuggestItemDto], deprecated: true, description: 'Đã thay bằng `fallback.items` (cùng mục, không có `relaxed`)' })
  suggest!: ExploreSuggestItemDto[];
  @ApiProperty({ type: [String], example: ['dịp', 'lễ'], deprecated: true, description: 'Đã thay bằng `fallback.dropped`' }) dropped!: string[];
}

// ---------------- POST /api/search/posts (tìm bài trên app và web Cảm hứng)

export const SearchPostsRequestSchema = z.object({
  q: z.string().trim().min(1, 'Nhập điều muốn tìm').max(200),
  postType: z.enum(POST_TYPES as [PostType, ...PostType[]]).default('all'),
  cursor: z.string().regex(/^\d+$/, 'cursor lấy từ nextCursor của trang trước').nullish().transform((c) => c ?? undefined),
  limit: z.number().int().min(1).max(50).default(20),
});

export class SearchPostsRequestDto {
  @ApiProperty({ example: 'lịch trình đà lạt 3n2đ dưới 3tr', description: 'Câu người dùng gõ (1–200 ký tự)' }) q!: string;
  @ApiProperty({
    enum: POST_TYPES,
    required: false,
    default: 'all',
    description: 'all: cả lộ trình, video, bài viết · plan: bài có lộ trình (gồm video kèm lộ trình) · video · post: bài viết thường',
  })
  postType?: PostType;
  @ApiProperty({ type: String, required: false, nullable: true, description: '`nextCursor` của trang trước' }) cursor?: string | null;
  @ApiProperty({ required: false, default: 20, description: '1–50' }) limit?: number;
}

export class SearchPostsResponseDto {
  @ApiProperty({ type: ExploreUnderstoodDto, description: 'Máy hiểu câu thế nào (hiện dạng chip)' }) understood!: ExploreUnderstoodDto;
  @ApiProperty({
    type: [ExploreItemDto],
    description: 'Bài đã xếp theo mức khớp, đã bỏ bài bị ẩn. `reason` luôn có số ngày (nếu có lộ trình) và lượt thích',
  })
  items!: ExploreItemDto[];
  @ApiProperty({ example: 12, description: 'Số bài khớp trên mọi trang' }) total!: number;
  @ApiProperty({ type: String, nullable: true, description: 'Con trỏ trang sau; null = hết' }) nextCursor!: string | null;
  @ApiProperty({
    type: [String],
    description: 'Từ trong câu mà dữ liệu không có. Chỉ có giá trị khi `isFallback = true`, rỗng nếu không',
  })
  dropped!: string[];
  @ApiProperty({
    description:
      'true: không bài nào khớp đủ câu nên `items` là kết quả thay thế sau khi nới điều kiện (xem `fallbackRelaxed`). FE nên báo "Kết quả thay thế cho “q”"',
  })
  isFallback!: boolean;
  @ApiProperty({ enum: RELAX_VALUES, isArray: true, example: ['budget'], description: `Chỉ có giá trị khi \`isFallback = true\`. ${RELAX_DESCRIPTION}` })
  fallbackRelaxed!: Array<(typeof RELAX_VALUES)[number]>;
}
