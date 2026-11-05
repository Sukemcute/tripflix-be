import { Injectable } from '@nestjs/common';
import { CatalogUseCases } from './inventory/application/catalog.use-cases.js';
import type { AvailabilityResult, CatalogPage, CheckAvailabilityQuery, ListCatalogQuery } from './inventory/application/catalog-types.js';

/**
 * Cửa duy nhất để module khác đọc dữ liệu commerce, gọi trong tiến trình (docs/11 §3.2). Chỉ đọc.
 * Module khác inject class này qua CommerceModule, không đọc bảng của commerce.
 */
@Injectable()
export class CommerceFacade {
  constructor(private readonly catalog: CatalogUseCases) {}

  /** Danh mục khách sạn hoặc chuyến bay để đánh chỉ mục: tên, tỉnh thành, ảnh, giá thấp nhất, số ngày còn bán. */
  listCatalog(query: ListCatalogQuery = {}): Promise<CatalogPage> {
    return this.catalog.listCatalog(query);
  }

  /** Còn chỗ và giá mới nhất cho nhiều sản phẩm trong một lần gọi; giữ đúng thứ tự productIds. */
  checkAvailability(query: CheckAvailabilityQuery): Promise<AvailabilityResult[]> {
    return this.catalog.checkAvailability(query);
  }
}
