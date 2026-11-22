import { BadRequestException, Body, Controller, HttpCode, HttpException, HttpStatus, Inject, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiBadRequestResponse, ApiBody, ApiOkResponse, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CommerceError, DATABASE_UNAVAILABLE_MESSAGE, RETRY_AFTER_SECONDS, isDatabaseUnavailable } from '../../../commerce/index.js';
import { StayDto } from '../../search/api/dto.js';
import { TripAddonUseCases } from '../application/trip-addons.use-cases.js';
import { BUDGET_LEVELS, DEFAULT_TRIP_STAYS_PARAMS, STAY_GROUPS } from '../domain/rankers/trip-stays.js';
import { FLIGHT_GROUPS } from '../domain/rankers/trip-flights.js';

const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày dạng YYYY-MM-DD');
const AirportSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{3}$/, 'Mã sân bay gồm 3 chữ cái')
  .transform((code) => code.toUpperCase());

export const TripAddonRequestSchema = z
  .object({
    items: z
      .array(
        z.discriminatedUnion('type', [
          z
            .object({ type: z.literal('hotel'), hotelId: z.string().min(1).max(100), checkIn: IsoDateSchema, checkOut: IsoDateSchema })
            .strict()
            .refine((h) => h.checkOut > h.checkIn, { path: ['checkOut'], message: 'Ngày trả phòng phải sau ngày nhận phòng' }),
          z.object({ type: z.literal('flight'), fromAirport: AirportSchema, toAirport: AirportSchema, date: IsoDateSchema }).strict(),
        ]),
      )
      .min(1)
      .max(10),
    adults: z.number().int().min(1).max(9),
    rooms: z.number().int().min(1).max(9).optional(),
    fromAirport: AirportSchema.nullish(),
    budgetLevels: z.array(z.enum(BUDGET_LEVELS)).max(3).nullish(),
    perGroup: z.number().int().min(1).max(10).default(4),
  })
  .strict();

class TripItemDto {
  @ApiProperty({ enum: ['hotel', 'flight'] }) type!: 'hotel' | 'flight';
  @ApiPropertyOptional({ example: 'P-h-nt-01', description: 'hotel: mã khách sạn (propertyId của mục phòng trong giỏ)' }) hotelId?: string;
  @ApiPropertyOptional({ format: 'date', description: 'hotel: ngày nhận phòng' }) checkIn?: string;
  @ApiPropertyOptional({ format: 'date', description: 'hotel: ngày trả phòng' }) checkOut?: string;
  @ApiPropertyOptional({ example: 'SGN', description: 'flight: sân bay đi' }) fromAirport?: string;
  @ApiPropertyOptional({ example: 'CXR', description: 'flight: sân bay đến' }) toAirport?: string;
  @ApiPropertyOptional({ format: 'date', description: 'flight: ngày bay' }) date?: string;
}

export class TripAddonRequestDto {
  @ApiProperty({ type: [TripItemDto], description: 'Các mục người dùng đang chọn, chưa giữ chỗ (1–10)' }) items!: TripItemDto[];
  @ApiProperty({ example: 2, description: 'Số người lớn (1–9): giá vé gợi ý tính cho chừng này người' }) adults!: number;
  @ApiPropertyOptional({ example: 1, description: 'Số phòng cho khách sạn gợi ý; bỏ trống thì commerce tự tính' }) rooms?: number;
  @ApiPropertyOptional({ type: String, nullable: true, example: 'HAN', description: 'Sân bay đi cho vé gợi ý (ô "Bay từ"); bỏ trống hoặc không có chuyến thì tự chọn SGN, rồi HAN' })
  fromAirport?: string | null;
  @ApiPropertyOptional({
    enum: BUDGET_LEVELS,
    isArray: true,
    nullable: true,
    example: ['moderate'],
    description: `Mức chi phí của người dùng (travelPreferences.budgetLevels ở /api/auth/me). Chọn nhiều thì lấy mức thoáng nhất. Bỏ trống: ${DEFAULT_TRIP_STAYS_PARAMS.defaultBudget}`,
  })
  budgetLevels?: string[] | null;
  @ApiPropertyOptional({ example: 4, description: 'Số mục mỗi nhóm tiêu chí, 1–10, mặc định 4' }) perGroup?: number;
}

class PlaceDto {
  @ApiProperty({ example: 'nha-trang' }) slug!: string;
  @ApiProperty({ example: 'Nha Trang' }) name!: string;
}

export class FlightAddonDto {
  @ApiProperty({ example: 'VN1234-SGN-CXR', description: 'Mã chuyến' }) flightKey!: string;
  @ApiProperty({ example: 'VN1234-SGN-CXR--Y', description: 'Hạng ghế rẻ nhất còn chỗ: gửi làm `productId` của mục trong `POST /checkout`' }) productId!: string;
  @ApiProperty({ example: 'ECO', description: 'Gửi làm `ratePlanCode` của mục trong `POST /checkout`' }) ratePlanCode!: string;
  @ApiProperty({ example: 'SGN – CXR' }) name!: string;
  @ApiProperty({ type: String, nullable: true, example: 'Vietnam Airlines' }) airline!: string | null;
  @ApiProperty({ example: 'SGN' }) fromAirport!: string;
  @ApiProperty({ example: 'CXR' }) toAirport!: string;
  @ApiProperty({ format: 'date', description: 'Ngày bay: gửi làm `checkIn` của mục trong `POST /checkout`' }) date!: string;
  @ApiProperty({ type: String, nullable: true, example: '06:20' }) departTime!: string | null;
  @ApiProperty({ type: String, nullable: true, example: '07:30' }) arriveTime!: string | null;
  @ApiProperty({ example: 1_250_000, description: 'Một vé người lớn (VND), giá thật của ngày bay' }) unitPrice!: number;
  @ApiProperty({ example: 2_500_000, description: 'Mọi vé người lớn (VND). Vé trẻ em, em bé tính khi giữ chỗ' }) totalPrice!: number;
}

class FlightBadgeDto {
  @ApiProperty({ enum: Object.keys(FLIGHT_GROUPS), example: 'good_time' }) code!: string;
  @ApiProperty({ example: 'Tới 08:20, kịp nhận phòng', description: 'Lý do hiện trên thẻ' }) text!: string;
}

class FlightGroupDto {
  @ApiProperty({
    enum: Object.keys(FLIGHT_GROUPS),
    description:
      'cheapest: rẻ nhất · good_time: chiều đi tới trước 14:00 (không cất cánh trước 6:00), chiều về cất cánh từ 13:00 · fastest: ít phút bay nhất (chỉ khi các chuyến trên tuyến bay lâu khác nhau) · flexible: có hạng vé hoàn huỷ (giá riêng, chọn ở bước hạng vé) · popular: có lượt đặt 30 ngày. Mọi nhóm trừ cheapest chỉ nhận chuyến hợp ngân sách (budgetFit ≥ 0,5)',
  })
  code!: string;
  @ApiProperty({ example: 'Giờ đẹp', description: 'Tên chip' }) label!: string;
  @ApiProperty({ type: [String], description: '`flightKey` của các chuyến trong nhóm, tốt nhất trước' }) ids!: string[];
}

class FlightPickDto extends FlightAddonDto {
  @ApiProperty({ example: 1, description: 'Độ hợp ngân sách 0..1: 1 là trong ngân sách, giảm dần khi giá vượt mốc `budgetAnchor` của chiều đó' }) budgetFit!: number;
  @ApiProperty({ type: [FlightBadgeDto], description: 'Nhãn của mọi nhóm chứa chuyến này; rỗng nếu chuyến chỉ được thêm cho đủ lựa chọn' }) badges!: FlightBadgeDto[];
}

class FlightLegDto {
  @ApiProperty({ type: [FlightPickDto], description: 'Mọi chuyến trong các nhóm, cộng thêm chuyến rẻ cho đủ ít nhất 8 (nếu có); rẻ trước. Rỗng khi hết chỗ' })
  items!: FlightPickDto[];
  @ApiProperty({ type: [FlightGroupDto], description: 'Nhóm tiêu chí theo thứ tự hiện chip (theo mức chi phí); nhóm không có chuyến nào thì không có' }) groups!: FlightGroupDto[];
  @ApiProperty({ enum: BUDGET_LEVELS, description: 'Mức chi phí ranker đã dùng' }) budget!: string;
  @ApiProperty({ type: Number, nullable: true, example: 1_000_000, description: 'Mốc giá một vé (VND) theo mức chi phí, tính trên giá thật các chuyến của chiều này; null khi cao cấp' })
  budgetAnchor!: number | null;
}

class FlightAddonsDto {
  @ApiProperty({ type: PlaceDto, description: 'Nơi của khách sạn trong đơn' }) destination!: PlaceDto;
  @ApiProperty({ type: String, nullable: true, example: 'SGN', description: 'Sân bay đi đang dùng; null khi không có chuyến nào tới nơi này' }) fromAirport!: string | null;
  @ApiProperty({ type: [String], example: ['HAN', 'SGN'], description: 'Các sân bay có chuyến tới nơi này, cho ô "Bay từ"' }) origins!: string[];
  @ApiProperty({ format: 'date', description: 'Ngày nhận phòng sớm nhất' }) departDate!: string;
  @ApiProperty({ format: 'date', description: 'Ngày trả phòng muộn nhất' }) returnDate!: string;
  @ApiProperty({ type: FlightLegDto, description: 'Chiều đi, ngày `departDate`' }) outbound!: FlightLegDto;
  @ApiProperty({ type: FlightLegDto, description: 'Chiều về, ngày `returnDate`' }) inbound!: FlightLegDto;
}

class StayBadgeDto {
  @ApiProperty({ enum: Object.keys(STAY_GROUPS), example: 'near_sights' }) code!: string;
  @ApiProperty({ example: 'Cách Tháp Bà Ponagar 800 m', description: 'Lý do hiện trên thẻ' }) text!: string;
}

class StayGroupDto {
  @ApiProperty({
    enum: Object.keys(STAY_GROUPS),
    description:
      'cheap: rẻ trước · top_rated: điểm đánh giá có trọng số theo số lượt (từ 10 đánh giá) · near_sights: gần điểm tham quan nhất (≤ 3 km) · lively: nhiều điểm tham quan, quán ăn, cà phê trong 1,5 km (từ 10 chỗ) · value: từ 4 sao, rẻ hơn ≥ 10% so với trung vị cùng hạng sao · popular: có lượt đặt 30 ngày. Mọi nhóm trừ cheap chỉ nhận khách sạn hợp ngân sách (budgetFit ≥ 0,5) và xếp có nhân budgetFit. Hai nhóm theo địa điểm chỉ có ở nơi có dữ liệu địa điểm',
  })
  code!: string;
  @ApiProperty({ example: 'Gần chỗ đi chơi', description: 'Tên chip' }) label!: string;
  @ApiProperty({ type: [String], description: '`hotelId` của các khách sạn trong nhóm, tốt nhất trước' }) ids!: string[];
}

class NearestSightDto {
  @ApiProperty({ example: 'Tháp Bà Ponagar' }) name!: string;
  @ApiProperty({ example: 0.8 }) km!: number;
}

class StayPickDto extends StayDto {
  @ApiProperty({ type: NearestSightDto, nullable: true, description: 'Điểm tham quan gần nhất; null khi nơi này chưa có dữ liệu địa điểm' }) nearestSight!: NearestSightDto | null;
  @ApiProperty({ type: Number, nullable: true, example: 42, description: 'Số điểm tham quan, quán ăn, cà phê trong 1,5 km; null như trên' }) placesNearby!: number | null;
  @ApiProperty({ example: 1, description: 'Độ hợp ngân sách 0..1: 1 là trong ngân sách, giảm dần khi giá vượt mốc `budgetAnchor`' }) budgetFit!: number;
  @ApiProperty({ type: [StayBadgeDto], description: 'Nhãn của mọi nhóm chứa khách sạn này' }) badges!: StayBadgeDto[];
}

class StayAddonsDto {
  @ApiProperty({ type: PlaceDto, description: 'Tỉnh của nơi đến (gồm các điểm đến trong tỉnh)' }) place!: PlaceDto;
  @ApiProperty({ format: 'date', description: 'Ngày bay chiều đi' }) checkIn!: string;
  @ApiProperty({ format: 'date', description: 'Ngày bay chiều về; vé một chiều thì sau ngày đi 2 đêm' }) checkOut!: string;
  @ApiProperty({ type: [StayPickDto], description: 'Khách sạn trong các nhóm, mỗi khách sạn một lần, giá thật cho đúng ngày' }) items!: StayPickDto[];
  @ApiProperty({ type: [StayGroupDto], description: 'Nhóm tiêu chí theo thứ tự hiện chip; nhóm không có khách sạn nào thì không có' }) groups!: StayGroupDto[];
  @ApiProperty({ enum: BUDGET_LEVELS, description: 'Mức chi phí ranker đã dùng' }) budget!: string;
  @ApiProperty({ type: Number, nullable: true, example: 760_000, description: 'Mốc giá một đêm (VND) theo mức chi phí, tính trên giá thật của các khách sạn còn phòng; null khi cao cấp' })
  budgetAnchor!: number | null;
}

export class TripAddonsDto {
  @ApiProperty({ enum: ['flight', 'hotel'], nullable: true, description: 'Loại đang thiếu; null khi đủ cả phòng và vé' }) missing!: 'flight' | 'hotel' | null;
  @ApiProperty({ type: FlightAddonsDto, nullable: true, description: 'Có khi `missing = flight`; null nếu khách sạn không còn trong danh mục' })
  flights!: FlightAddonsDto | null;
  @ApiProperty({ type: StayAddonsDto, nullable: true, description: 'Có khi `missing = hotel`; null nếu sân bay đến không có trong danh mục' })
  stays!: StayAddonsDto | null;
}

const invalid = (errors: { field: string; message: string }[]) => new BadRequestException({ message: 'Tham số không hợp lệ', errors });

/** Gợi ý phần còn thiếu của chuyến (F10, TF39). Công khai, chỉ đọc. */
@ApiTags('discovery')
@Controller('recommendations')
export class TripAddonsController {
  constructor(@Inject(TripAddonUseCases) private readonly addons: TripAddonUseCases) {}

  @Post('trip-addons')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Gợi ý phần còn thiếu của chuyến (vé máy bay hoặc khách sạn), trước khi giữ chỗ',
    description: [
      'Công khai, chỉ đọc. Gọi ở màn xem lại trước khi giữ chỗ (giỏ phòng, xem lại chuyến bay) với các mục đang chọn.',
      '',
      '- Có phòng, chưa có vé: chuyến bay tới nơi của khách sạn, chiều đi ngày nhận phòng, chiều về ngày trả phòng (từ khách sạn cuối), bay từ `fromAirport` (mặc định SGN). Xếp bằng ranker `trip_flights@v0` trên hồ sơ `flight_profile@v0`. Nhóm: rẻ nhất, giờ đẹp, bay nhanh, có vé hoàn huỷ, được đặt nhiều.',
      '- Có vé, chưa có phòng: khách sạn còn phòng ở tỉnh của sân bay đến, từ ngày đi tới ngày về (vé một chiều: 2 đêm). Xếp bằng ranker `trip_stays@v0` trên hồ sơ `hotel_profile@v0` (job 10 phút). Nhóm: giá tốt, đánh giá cao, gần chỗ đi chơi, nhiều chỗ ăn chơi, đáng tiền, được đặt nhiều; mọi nhóm trừ giá tốt bỏ khách sạn vượt ngân sách (`budgetLevels`).',
      '- Mỗi nhóm có `perGroup` mục; FE hiện nhóm thành chip, mục mang nhãn lý do (`badges`).',
      '- Đủ cả hai: `missing = null`, không gợi ý.',
      '- Người dùng tích một gợi ý thì gửi nó cùng các mục cũ trong **một** `POST /checkout` (giữ chỗ chung, trả tiền một lần).',
    ].join('\n'),
  })
  @ApiBody({ type: TripAddonRequestDto })
  @ApiBadRequestResponse({ description: 'Sai định dạng, ngày trả phòng không sau ngày nhận phòng, ngày trong quá khứ, quá số đêm cho phép' })
  @ApiOkResponse({ type: TripAddonsDto })
  async suggest(@Body() body: unknown, @Res({ passthrough: true }) res: Response): Promise<TripAddonsDto> {
    const parsed = TripAddonRequestSchema.safeParse(body);
    if (!parsed.success) throw invalid(parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })));
    try {
      return await this.addons.suggest(parsed.data);
    } catch (err) {
      if (err instanceof CommerceError && err.code === 'invalid_query') throw invalid([{ field: err.field ?? '', message: err.message }]);
      if (isDatabaseUnavailable(err)) {
        res.setHeader('Retry-After', String(RETRY_AFTER_SECONDS));
        throw new HttpException({ statusCode: HttpStatus.SERVICE_UNAVAILABLE, message: DATABASE_UNAVAILABLE_MESSAGE, reason: 'SERVICE_UNAVAILABLE', error: 'Service Unavailable' }, HttpStatus.SERVICE_UNAVAILABLE);
      }
      throw err;
    }
  }
}
