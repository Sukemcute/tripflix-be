import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';
import { STAY_SORTS, type StaySort } from '../domain/stays.js';
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
}

export class StayPageDto {
  @ApiProperty({ type: [StayDto], description: 'Chỉ khách sạn còn phòng cho ngày và số khách đã chọn, đã lọc và sắp' })
  items!: StayDto[];
  @ApiProperty({ example: 12, description: 'Số khách sạn khớp trên mọi trang' }) total!: number;
  @ApiProperty({ type: String, nullable: true, example: '20', description: 'Gửi lại ở `cursor` để lấy trang sau; null là hết' })
  nextCursor!: string | null;
}
