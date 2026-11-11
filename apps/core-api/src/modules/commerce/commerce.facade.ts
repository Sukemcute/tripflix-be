import { Inject, Injectable } from '@nestjs/common';
import { COMMERCE_CLOCK, ORDER_STORE, type Clock, type OrderStore } from './booking/application/ports.js';
import { CatalogUseCases } from './inventory/application/catalog.use-cases.js';
import { TODAY, type Today } from './inventory/application/ports.js';
import { addDays } from './inventory/domain/sales-rules.js';
import type { AvailabilityResult, CatalogPage, CheckAvailabilityQuery, ListCatalogQuery } from './inventory/application/catalog-types.js';
import { TtlCache } from './inventory/application/ttl-cache.js';

/**
 * Trang tìm khách sạn (discovery /stays) gọi hai hàm dưới mỗi lần tìm cho cả tỉnh. Cache ngắn để nhiều người tìm
 * cùng nơi, cùng ngày không đọc lại cùng dữ liệu. Danh mục (tên, ảnh, sao) ít đổi nên giữ lâu hơn; còn phòng và giá
 * chỉ để hiển thị, giữ 15 giây vì giữ chỗ luôn kiểm lại tồn kho thật nên không bán quá.
 */
const CATALOG_TTL_MS = 60_000;
const AVAILABILITY_TTL_MS = 15_000;
const MAX_CACHE_ENTRIES = 2_000;

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
    @Inject(COMMERCE_CLOCK) private readonly clock: Clock,
  ) {}

  private readonly catalogCache = new TtlCache<CatalogPage>({
    ttlMs: CATALOG_TTL_MS,
    maxEntries: MAX_CACHE_ENTRIES,
    now: () => this.clock().getTime(),
  });
  private readonly availabilityCache = new TtlCache<AvailabilityResult[]>({
    ttlMs: AVAILABILITY_TTL_MS,
    maxEntries: MAX_CACHE_ENTRIES,
    now: () => this.clock().getTime(),
  });

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
    // Có ngày hôm nay trong khoá: qua ngày thì khoảng "days" đổi, không dùng lại kết quả hôm trước.
    const key = JSON.stringify([this.today(), query.type, query.provinceSlug, query.cursor, query.limit, query.days]);
    return this.catalogCache.get(key, () => this.catalog.listCatalog(query));
  }

  /** Còn chỗ và giá mới nhất cho nhiều sản phẩm trong một lần gọi; giữ đúng thứ tự productIds. */
  checkAvailability(query: CheckAvailabilityQuery): Promise<AvailabilityResult[]> {
    const key = JSON.stringify([this.today(), query.productIds, query.checkIn, query.checkOut, query.adults, query.rooms]);
    return this.availabilityCache.get(key, () => this.catalog.checkAvailability(query));
  }
}
