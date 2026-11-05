import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';
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
