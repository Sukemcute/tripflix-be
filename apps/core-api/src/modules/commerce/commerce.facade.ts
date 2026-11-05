import { Inject, Injectable } from '@nestjs/common';
import { ORDER_STORE, type OrderStore } from './booking/application/ports.js';
import { CatalogUseCases } from './inventory/application/catalog.use-cases.js';
import { TODAY, type Today } from './inventory/application/ports.js';
import { addDays } from './inventory/domain/sales-rules.js';
import type { AvailabilityResult, CatalogPage, CheckAvailabilityQuery, ListCatalogQuery } from './inventory/application/catalog-types.js';

/**
 * Cửa duy nhất để module khác đọc dữ liệu commerce, gọi trong tiến trình (docs/11 §3.2). Chỉ đọc.
 * Module khác inject class này qua CommerceModule, không đọc bảng của commerce.
 */
@Injectable()
export class CommerceFacade {
  constructor(
    private readonly catalog: CatalogUseCases,
    @Inject(ORDER_STORE) private readonly orders: OrderStore,
    @Inject(TODAY) private readonly today: Today,
  ) {}

  /**
   * Đơn đã trả tiền, thuộc đúng người dùng và chuyến đã kết thúc (mọi mục đã qua ngày trả phòng / ngày bay).
   * content dùng để gắn dấu "Đã đi thật" cho bài đăng. Mã không phải UUID hoặc không có đơn thì false.
   */
  async verifyCompletedBooking(bookingId: string, userId: string): Promise<boolean> {
    if (!/^[0-9a-f-]{36}$/i.test(bookingId)) return false;
    const order = await this.orders.findOrder(bookingId);
    if (!order || order.userId !== userId || order.status !== 'paid') return false;
    const ends = (await this.orders.findItems(bookingId)).map((i) => (i.productType === 'room' ? addDays(i.date, i.nights) : i.date));
    return ends.length > 0 && ends.every((end) => end <= this.today());
  }

  /** Danh mục khách sạn hoặc chuyến bay để đánh chỉ mục: tên, tỉnh thành, ảnh, giá thấp nhất, số ngày còn bán. */
  listCatalog(query: ListCatalogQuery = {}): Promise<CatalogPage> {
    return this.catalog.listCatalog(query);
  }

  /** Còn chỗ và giá mới nhất cho nhiều sản phẩm trong một lần gọi; giữ đúng thứ tự productIds. */
  checkAvailability(query: CheckAvailabilityQuery): Promise<AvailabilityResult[]> {
    return this.catalog.checkAvailability(query);
  }
}
