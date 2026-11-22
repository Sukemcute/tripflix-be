// Public API duy nhất của module commerce. Module khác chỉ được import từ file này.
export { CommerceModule } from './commerce.module.js';
export { CommerceFacade } from './commerce.facade.js';
export type {
  AvailabilityResult,
  CatalogFlight,
  CatalogHotel,
  CatalogItem,
  CatalogOption,
  CatalogPage,
  CatalogProductType,
  CatalogRatePlan,
  CheckAvailabilityQuery,
  ListCatalogQuery,
} from './inventory/application/catalog-types.js';
export type { UnavailableReason } from './inventory/domain/sales-rules.js';
export { CommerceError } from './inventory/domain/errors.js';
// Trang tìm (discovery /stays) đọc qua facade: DB lỗi thì báo 503 giống commerce thay vì 500.
export { DATABASE_UNAVAILABLE_MESSAGE, RETRY_AFTER_SECONDS, isDatabaseUnavailable } from './inventory/api/database-unavailable.js';
