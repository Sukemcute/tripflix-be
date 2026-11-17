import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';
import { FLIGHT_SORTS, STAY_SUGGEST_SORTS, type FlightSort, type StaySuggestSort } from '../domain/trip-builder.js';

const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày dạng YYYY-MM-DD');

export const SuggestFlightsQuerySchema = z
  .object({
    place: z.string().trim().min(1, 'Chọn nơi đến'),
    from: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'Mã sân bay 3 chữ'),
    departDate: IsoDateSchema,
    returnDate: IsoDateSchema.optional(),
    adults: z.coerce.number().int().min(1).max(9),
    sort: z.enum(FLIGHT_SORTS as [FlightSort, ...FlightSort[]]).default('cheapest'),
    limit: z.coerce.number().int().min(1).max(20).default(5),
  })
  .refine((q) => !q.returnDate || q.returnDate >= q.departDate, {
    path: ['returnDate'],
    message: 'Ngày về phải từ ngày đi trở đi',
  });

export const SuggestStaysQuerySchema = z
  .object({
    place: z.string().trim().min(1, 'Chọn nơi ở'),
    checkIn: IsoDateSchema,
    checkOut: IsoDateSchema,
    adults: z.coerce.number().int().min(1).max(9),
    sort: z.enum(STAY_SUGGEST_SORTS as [StaySuggestSort, ...StaySuggestSort[]]).default('best_price'),
    limit: z.coerce.number().int().min(1).max(20).default(5),
  })
  .refine((q) => q.checkOut > q.checkIn, { path: ['checkOut'], message: 'Ngày trả phòng phải sau ngày nhận phòng' });

export class SuggestReasonDto {
  @ApiProperty({ enum: ['cheapest', 'arrive_before_check_in', 'full_last_morning', 'best_price', 'top_rated'] })
  code!: string;
  @ApiProperty({ example: 'Tới 08:20, kịp nhận phòng', description: 'Câu ngắn hiện dưới lựa chọn' })
  text!: string;
}

export class FlightSuggestionDto {
  @ApiProperty({ example: 'VJ135-SGN-CXR', description: 'Mã chuyến (gom các hạng ghế)' }) flightId!: string;
  @ApiProperty({ example: 'VJ135-SGN-CXR--ECO', description: 'Hạng ghế rẻ nhất còn bán: gửi lên POST /checkout' }) productId!: string;
  @ApiProperty({ example: 'ECO_SAVER' }) ratePlanCode!: string;
  @ApiProperty({ example: 'Bay Sài Gòn – Cam Ranh sớm' }) name!: string;
  @ApiProperty({ type: String, nullable: true, example: 'Vietjet Air' }) airline!: string | null;
  @ApiProperty({ example: 'SGN' }) fromAirport!: string;
  @ApiProperty({ example: 'CXR' }) toAirport!: string;
  @ApiProperty({ type: String, nullable: true, example: '06:45' }) departTime!: string | null;
  @ApiProperty({ type: String, nullable: true, example: '08:20' }) arriveTime!: string | null;
  @ApiProperty({ example: 950_000, description: 'Một vé (VND)' }) unitPrice!: number;
  @ApiProperty({ example: 1_900_000, description: 'Mọi vé cho số khách đã chọn (VND)' }) totalPrice!: number;
  @ApiProperty({ type: SuggestReasonDto, nullable: true }) reason!: SuggestReasonDto | null;
}

export class FlightSuggestionsDto {
  @ApiProperty({ type: FlightSuggestionDto, isArray: true, description: 'Chiều đi, đã xếp theo `sort`' })
  outbound!: FlightSuggestionDto[];
  @ApiProperty({ type: FlightSuggestionDto, isArray: true, description: 'Chiều về; rỗng khi không gửi `returnDate`' })
  inbound!: FlightSuggestionDto[];
}

class StayRatingDto {
  @ApiProperty({ example: 4.9 }) average!: number;
  @ApiProperty({ example: 252 }) count!: number;
}

export class StaySuggestionDto {
  @ApiProperty({ example: 'P-h-nt-01' }) hotelId!: string;
  @ApiProperty({ type: String, nullable: true }) slug!: string | null;
  @ApiProperty({ example: 'Vinpearl Beachfront Nha Trang' }) name!: string;
  @ApiProperty({ type: Number, nullable: true, example: 5 }) stars!: number | null;
  @ApiProperty({ type: String, nullable: true }) thumbnail!: string | null;
  @ApiProperty({ type: StayRatingDto, nullable: true }) rating!: StayRatingDto | null;
  @ApiProperty({ example: 'P-h-nt-01--DLX', description: 'Loại phòng rẻ nhất còn bán: gửi lên POST /checkout' })
  roomProductId!: string;
  @ApiProperty({ example: 'RO' }) ratePlanCode!: string;
  @ApiProperty({ example: 3_320_000, description: 'Một đêm một phòng (VND)' }) unitPrice!: number;
  @ApiProperty({ example: 9_960_000, description: 'Cả kỳ ở, mọi phòng (VND)' }) totalPrice!: number;
  @ApiProperty({ type: SuggestReasonDto, nullable: true }) reason!: SuggestReasonDto | null;
}

export class StaySuggestionsDto {
  @ApiProperty({ type: StaySuggestionDto, isArray: true, description: 'Đã xếp theo `sort`' }) items!: StaySuggestionDto[];
}
