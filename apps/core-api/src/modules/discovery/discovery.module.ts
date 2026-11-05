import { Module } from '@nestjs/common';
import { createDb } from '@tripflix/db';
import { DB_POOLS, type DbPools } from '../../platform/tokens.js';
import { SuggestController } from './search/api/suggest.controller.js';
import { HOTEL_CATALOG, SUGGEST_STORE, type HotelCatalog } from './search/application/ports.js';
import { SuggestUseCases } from './search/application/suggest.use-cases.js';
import { DrizzleSuggestStore } from './search/infra/drizzle-suggest.store.js';
import { RebuildSuggestIndexJob } from './search/jobs/rebuild-suggest-index.job.js';

/**
 * Chưa có danh mục khách sạn trên develop: gợi ý chỉ có địa điểm và sân bay.
 * Khi TF06 (CommerceFacade) merge: imports CommerceModule và thay bằng commerce.listCatalog({ type: 'hotel', cursor, limit: 200 }).
 */
const emptyHotelCatalog: HotelCatalog = { listHotels: () => Promise.resolve({ items: [], nextCursor: null }) };

/**
 * Module discovery. Chủ: Duy (backup Dũng). Xem README.md cùng thư mục.
 * Module khác chỉ dùng những gì được export trong index.ts.
 */
@Module({
  controllers: [SuggestController],
  providers: [
    { provide: SUGGEST_STORE, inject: [DB_POOLS], useFactory: (pools: DbPools) => new DrizzleSuggestStore(createDb(pools.discovery)) },
    { provide: HOTEL_CATALOG, useValue: emptyHotelCatalog },
    SuggestUseCases,
    RebuildSuggestIndexJob,
  ],
})
export class DiscoveryModule {}
