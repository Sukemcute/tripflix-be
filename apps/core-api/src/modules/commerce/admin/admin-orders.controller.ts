import { Controller, Get, Header, Inject, NotFoundException, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Roles } from '@tripflix/auth';
import { z } from 'zod';
import { ZodQuery } from '../inventory/api/http.js';
import { AdminOrdersStore } from './admin-orders.store.js';
import { ANOMALY_KINDS } from './anomaly-kinds.js';
import { AdmissionLane } from '../platform/admission-lane.decorator.js';

const ORDER_STATUSES = ['pending', 'paying', 'paid', 'cancelled', 'expired'] as const;
const csvOf = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .string()
    .max(200)
    .transform((value) => [...new Set(value.split(',').map((s) => s.trim()).filter(Boolean))])
    .pipe(z.array(z.enum(values)));

export const SearchAdminOrdersQuerySchema = z.object({
  q: z.string().trim().min(1).max(200).optional(),
  status: csvOf(ORDER_STATUSES).optional(),
  /** Trang sau: createdAt của đơn cuối trang trước. */
  before: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const ListAnomaliesQuerySchema = z.object({
  kind: csvOf(ANOMALY_KINDS).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export const SearchAdminProductsQuerySchema = z.object({
  kind: z.enum(['room', 'flight']),
  q: z.string().trim().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

/** TF43: tra đơn và đơn bất thường cho quản trị. Chỉ đọc; dữ liệu có thông tin liên hệ của khách nên chỉ superadmin. */
@ApiTags('admin-commerce')
@ApiBearerAuth()
@Controller('admin/commerce')
@AdmissionLane('exempt')
@Roles('superadmin')
export class AdminOrdersController {
  constructor(@Inject(AdminOrdersStore) private readonly store: AdminOrdersStore) {}

  @Get('orders')
  @Header('Cache-Control', 'no-store')
  @ApiQuery({ name: 'q', required: false, description: 'Mã xác nhận, mã đơn, mã người dùng, số điện thoại hoặc email' })
  @ApiQuery({ name: 'status', required: false, description: 'Lọc trạng thái, nhiều giá trị cách bằng dấu phẩy' })
  @ApiQuery({ name: 'before', required: false, description: 'createdAt của đơn cuối trang trước' })
  @ApiQuery({ name: 'limit', required: false })
  @ApiOkResponse({ description: 'Đơn mới nhất trước; nextBefore=null khi hết' })
  async search(@Query(new ZodQuery(SearchAdminOrdersQuerySchema)) query: z.infer<typeof SearchAdminOrdersQuerySchema>) {
    const items = await this.store.search({ q: query.q, statuses: query.status, before: query.before, limit: query.limit });
    return { items, nextBefore: items.length === query.limit ? items[items.length - 1]!.createdAt : null };
  }

  @Get('products')
  @Header('Cache-Control', 'no-store')
  @ApiQuery({ name: 'kind', enum: ['room', 'flight'] })
  @ApiQuery({ name: 'q', required: false, description: 'Mã, tên, khách sạn, tỉnh, sân bay hoặc số hiệu chuyến' })
  @ApiQuery({ name: 'limit', required: false })
  @ApiOkResponse({ description: 'Loại phòng hoặc chuyến bay để chọn khi sửa lịch' })
  async products(@Query(new ZodQuery(SearchAdminProductsQuerySchema)) query: z.infer<typeof SearchAdminProductsQuerySchema>) {
    return { items: await this.store.searchProducts(query) };
  }

  @Get('orders/:id')
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ description: 'Đơn, mục, khách, khoản trừ, khoản hoàn, lịch sử trạng thái và bất thường của đơn' })
  async detail(@Param('id', ParseUUIDPipe) id: string) {
    const detail = await this.store.detail(id);
    if (!detail) throw new NotFoundException('Không tìm thấy đơn');
    const anomalies = await this.store.findAnomalies({ orderId: id, limitPerKind: 1, now: new Date() });
    return { ...detail, anomalies: anomalies.map(({ kind, detail: info, since }) => ({ kind, detail: info, since })) };
  }

  @Get('anomalies')
  @Header('Cache-Control', 'no-store')
  @ApiQuery({ name: 'kind', required: false, description: `Loại, cách bằng dấu phẩy: ${ANOMALY_KINDS.join(', ')}` })
  @ApiQuery({ name: 'limit', required: false, description: 'Tối đa mỗi loại' })
  @ApiOkResponse({ description: 'Đơn bất thường, cũ nhất trước trong từng loại, kèm số đếm theo loại' })
  async anomalies(@Query(new ZodQuery(ListAnomaliesQuerySchema)) query: z.infer<typeof ListAnomaliesQuerySchema>) {
    const items = await this.store.findAnomalies({ kinds: query.kind, limitPerKind: query.limit, now: new Date() });
    const counts = Object.fromEntries((query.kind ?? ANOMALY_KINDS).map((kind) => [kind, items.filter((a) => a.kind === kind).length]));
    return { items, counts };
  }
}
