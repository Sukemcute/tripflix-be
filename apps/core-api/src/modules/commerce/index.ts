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
