import { Module } from '@nestjs/common';
import { createDb } from '@tripflix/db';
import { DB_POOLS, type DbPools } from '../../platform/tokens.js';
import { CommerceFacade, CommerceModule, type CatalogHotel } from '../commerce/index.js';
import { StaysController } from './search/api/stays.controller.js';
import { SuggestController } from './search/api/suggest.controller.js';
import { HOTEL_CATALOG, SUGGEST_STORE, type HotelCatalog } from './search/application/ports.js';
import { StaysUseCases } from './search/application/stays.use-cases.js';
import { SuggestUseCases } from './search/application/suggest.use-cases.js';
import { DrizzleSuggestStore } from './search/infra/drizzle-suggest.store.js';
import { RebuildSuggestIndexJob } from './search/jobs/rebuild-suggest-index.job.js';

/** Danh mục khách sạn cho chỉ mục gợi ý: chỉ cần tên, nơi, sao nên days: 1 cho nhẹ. */
const commerceHotelCatalog = (commerce: CommerceFacade): HotelCatalog => ({
  listHotels: async (cursor) => {
    const page = await commerce.listCatalog({ type: 'hotel', cursor, limit: 200, days: 1 });
    const items = page.items
      .filter((item): item is CatalogHotel => item.type === 'hotel')
      .map(({ id, name, province, stars }) => ({ id, name, province, stars }));
    return { items, nextCursor: page.nextCursor };
  },
});

/**
 * Module discovery. Chủ: Duy (backup Dũng). Xem README.md cùng thư mục.
 * Module khác chỉ dùng những gì được export trong index.ts. Gọi commerce qua CommerceFacade (một chiều, trong tiến trình).
 */
@Module({
  imports: [CommerceModule],
  controllers: [SuggestController, StaysController],
  providers: [
    { provide: SUGGEST_STORE, inject: [DB_POOLS], useFactory: (pools: DbPools) => new DrizzleSuggestStore(createDb(pools.discovery)) },
    { provide: HOTEL_CATALOG, inject: [CommerceFacade], useFactory: commerceHotelCatalog },
    SuggestUseCases,
    StaysUseCases,
    RebuildSuggestIndexJob,
  ],
})
export class DiscoveryModule {}
