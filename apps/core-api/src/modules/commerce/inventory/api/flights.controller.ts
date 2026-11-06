import { Controller, Get, Inject, Param, Query, UseFilters } from '@nestjs/common';
import { ApiNotFoundResponse, ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import { FlightSearchUseCases } from '../application/flight-search.use-cases.js';
import { FlightOfferDto, FlightOfferQueryDto, FlightOfferQuerySchema, FlightRouteDto, FlightSearchQueryDto, FlightSearchQuerySchema, FlightSearchResultDto } from './flights.dto.js';
import { CommerceErrorFilter, ZodQuery } from './http.js';

/** Tìm chuyến bay còn ghế cho web và app. Công khai, không cần đăng nhập; chỉ đọc. Đặt vé qua POST /checkout. */
@ApiTags('flights')
@Controller('flights')
@UseFilters(CommerceErrorFilter)
export class FlightsController {
  constructor(@Inject(FlightSearchUseCases) private readonly flights: FlightSearchUseCases) {}

  @Get()
  // Kiểu tham số là giao của DTO và schema zod nên Swagger không tự đọc được: khai báo tường minh.
  @ApiQuery({ type: FlightSearchQueryDto })
  @ApiOkResponse({ type: FlightSearchResultDto })
  search(@Query(new ZodQuery(FlightSearchQuerySchema)) query: FlightSearchQueryDto & z.infer<typeof FlightSearchQuerySchema>) {
    return this.flights.searchFlights(query);
  }

  /** Các tuyến đang có chuyến, để web và app dựng ô chọn điểm đi, điểm đến. */
  @Get('routes')
  @ApiOkResponse({ type: [FlightRouteDto] })
  listRoutes() {
    return this.flights.listRoutes();
  }

  @Get(':id')
  @ApiQuery({ type: FlightOfferQueryDto })
  @ApiOkResponse({ type: FlightOfferDto })
  @ApiNotFoundResponse({ description: 'Không có chuyến bay này' })
  getFlight(@Param('id') id: string, @Query(new ZodQuery(FlightOfferQuerySchema)) query: FlightOfferQueryDto & z.infer<typeof FlightOfferQuerySchema>) {
    return this.flights.getFlightOffer(id, query);
  }
}
