import { Controller, Get, Header, Inject } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Roles } from '@tripflix/auth';
import { CommerceMetrics } from './commerce-metrics.js';
import { AdmissionLane } from '../platform/admission-lane.decorator.js';

/** Số đo vận hành của commerce trên mọi instance (D1). Chỉ superadmin; dữ liệu vận hành nội bộ, không phải nghiệp vụ. */
@ApiTags('admin-commerce')
@ApiBearerAuth()
@Controller('admin/commerce')
@AdmissionLane('exempt')
@Roles('superadmin')
export class AdminMetricsController {
  constructor(@Inject(CommerceMetrics) private readonly metrics: CommerceMetrics) {}

  @Get('metrics')
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ description: 'Số đo 5 giây gần nhất của từng instance và tổng; isAvailable=false khi Redis không đọc được' })
  getMetrics() {
    return this.metrics.readAll();
  }
}
