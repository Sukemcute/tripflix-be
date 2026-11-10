import { Module } from '@nestjs/common';
import { createDb } from '@tripflix/db';
import { DB_POOLS, type DbPools } from '../../platform/tokens.js';
import { CommerceFacade, CommerceModule, type CatalogHotel } from '../commerce/index.js';
import { ContentFacade, ContentModule } from '../content/index.js';
import { HomeRecommendationsController } from './recommend/api/home-recommendations.controller.js';
import { HomeRecommendationUseCases } from './recommend/application/home-recommendations.use-cases.js';
import { ExploreController } from './search/api/explore.controller.js';
import { StaysController } from './search/api/stays.controller.js';
import { SuggestController } from './search/api/suggest.controller.js';
import { ExploreUseCases } from './search/application/explore.use-cases.js';
import {
  EXPLORE_CATALOG,
  EXPLORE_STORE,
  HOTEL_CATALOG,
  SUGGEST_STORE,
  type ExploreCatalog,
  type HotelCatalog,
} from './search/application/ports.js';
import { StaysUseCases } from './search/application/stays.use-cases.js';
import { SuggestUseCases } from './search/application/suggest.use-cases.js';
import { ExploreContentConsumer } from './search/consumers/explore-content.consumer.js';
import { DrizzleExploreStore } from './search/infra/drizzle-explore.store.js';
import { DrizzleSuggestStore } from './search/infra/drizzle-suggest.store.js';
import { RebuildExploreIndexJob } from './search/jobs/rebuild-explore-index.job.js';
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

/** Khách sạn + bài cho tìm khám phá. days: 30 để priceFrom là giá thấp nhất 30 ngày tới. */
const exploreCatalog = (commerce: CommerceFacade, content: ContentFacade): ExploreCatalog => ({
  listHotels: async (cursor) => {
    const page = await commerce.listCatalog({ type: 'hotel', cursor, limit: 200, days: 30 });
    return { items: page.items.filter((item): item is CatalogHotel => item.type === 'hotel'), nextCursor: page.nextCursor };
  },
  listPosts: (cursor) => content.listPosts({ cursor, limit: 100 }),
  findVisiblePostIds: async (postIds) => new Set((await content.getVisiblePosts(postIds)).map((p) => p.id)),
});

/**
 * Module discovery. Chủ: Duy (backup Dũng). Xem README.md cùng thư mục.
 * Module khác chỉ dùng những gì được export trong index.ts. Gọi commerce, content qua facade (một chiều, trong tiến trình).
 */
@Module({
  imports: [CommerceModule, ContentModule],
  controllers: [SuggestController, StaysController, ExploreController, HomeRecommendationsController],
  providers: [
    { provide: SUGGEST_STORE, inject: [DB_POOLS], useFactory: (pools: DbPools) => new DrizzleSuggestStore(createDb(pools.discovery)) },
    { provide: HOTEL_CATALOG, inject: [CommerceFacade], useFactory: commerceHotelCatalog },
    { provide: EXPLORE_STORE, inject: [DB_POOLS], useFactory: (pools: DbPools) => new DrizzleExploreStore(createDb(pools.discovery)) },
    { provide: EXPLORE_CATALOG, inject: [CommerceFacade, ContentFacade], useFactory: exploreCatalog },
    SuggestUseCases,
    StaysUseCases,
    HomeRecommendationUseCases,
    ExploreUseCases,
    RebuildSuggestIndexJob,
    RebuildExploreIndexJob,
    ExploreContentConsumer,
  ],
})
export class DiscoveryModule {}
