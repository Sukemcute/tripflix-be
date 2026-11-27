import { BadRequestException, Controller, Get, Header, Inject, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Roles } from '@tripflix/auth';
import { ObservabilityService } from '../application/observability.service.js';
import {
  ObservabilityDto,
  OverviewQuerySchema,
  TRAFFIC_AUDIENCES,
  TraceDetailDto,
  TraceListDto,
  TraceQuerySchema,
} from './dto.js';

@ApiTags('analytics')
@ApiBearerAuth()
@Roles('superadmin')
@Controller('analytics/observability')
export class ObservabilityController {
  constructor(@Inject(ObservabilityService) private readonly service: ObservabilityService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiQuery({ name: 'range', required: false, enum: ['15m', '1h', '6h', '24h'] })
  @ApiQuery({ name: 'service', required: false, type: String })
  @ApiQuery({ name: 'audience', required: false, enum: [...TRAFFIC_AUDIENCES] })
  @ApiOkResponse({ type: ObservabilityDto })
  getOverview(@Query() raw: unknown): Promise<ObservabilityDto> {
    const query = OverviewQuerySchema.safeParse(raw);
    if (!query.success) throw new BadRequestException('Bộ lọc số liệu không hợp lệ');
    return this.service.getOverview(query.data);
  }

  @Get('traces')
  @Header('Cache-Control', 'no-store')
  @ApiQuery({ name: 'range', required: false, enum: ['15m', '1h', '6h', '24h'] })
  @ApiQuery({ name: 'service', required: false, type: String })
  @ApiQuery({ name: 'errorsOnly', required: false, enum: ['true', 'false'] })
  @ApiQuery({ name: 'includeSuccessfulPreflights', required: false, enum: ['true', 'false'], description: 'Hiện cả preflight CORS đã xác nhận thành công; mặc định ẩn' })
  @ApiQuery({ name: 'minDurationMs', required: false, type: Number })
  @ApiOkResponse({ type: TraceListDto })
  listTraces(@Query() raw: unknown): Promise<TraceListDto> {
    const query = TraceQuerySchema.safeParse(raw);
    if (!query.success) throw new BadRequestException('Bộ lọc trace không hợp lệ');
    return this.service.listTraces(query.data);
  }

  @Get('traces/:traceId')
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ type: TraceDetailDto })
  getTrace(@Param('traceId') traceId: string): Promise<TraceDetailDto> {
    if (!/^[a-f0-9]{32}$/i.test(traceId)) throw new BadRequestException('Mã trace không hợp lệ');
    return this.service.getTrace(traceId.toLowerCase());
  }
}
