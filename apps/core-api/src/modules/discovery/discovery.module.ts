import { Module } from '@nestjs/common';
import { createDb } from '@tripflix/db';
import { RedisStreamsEventBus } from '@tripflix/event-bus';
import type { Redis } from 'ioredis';
import { DB_POOLS, REDIS, type DbPools } from '../../platform/tokens.js';
import { CommerceFacade, CommerceModule, type CatalogHotel } from '../commerce/index.js';
import { ContentFacade, ContentModule } from '../content/index.js';
import { DiscoveryEventsConsumer } from './consumers/discovery-events.consumer.js';
import { HomeRecommendationsController } from './recommend/api/home-recommendations.controller.js';
import { PostRecommendationsController } from './recommend/api/post-recommendations.controller.js';
import { HomeRecommendationUseCases } from './recommend/application/home-recommendations.use-cases.js';
import { BuildFeaturesUseCases } from './recommend/application/build-features.use-cases.js';
import { RecommendIngestUseCases } from './recommend/application/ingest.use-cases.js';
import { RECOMMEND_CATALOG, RECOMMEND_STORE, SERVED_STORE, type RecommendCatalog } from './recommend/application/ports.js';
import { PostRecommendationUseCases } from './recommend/application/post-recommendations.use-cases.js';
import { DrizzleRecommendStore } from './recommend/infra/drizzle-recommend.store.js';
import { RedisServedStore } from './recommend/infra/redis-served.store.js';
import { BuildFeaturesJob } from './recommend/jobs/build-features.job.js';
import { PurgeInteractionsJob } from './recommend/jobs/purge-interactions.job.js';
import { AdminIndexHealthController } from './search/api/admin-index-health.controller.js';
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
import { SEARCH_EVENT_BUS, SearchEventsPublisher } from './search/application/search-events.publisher.js';
import { StaysUseCases } from './search/application/stays.use-cases.js';
import { SuggestUseCases } from './search/application/suggest.use-cases.js';
import { DrizzleExploreStore } from './search/infra/drizzle-explore.store.js';
import { DrizzleSuggestStore } from './search/infra/drizzle-suggest.store.js';
import { IndexHealth } from './search/jobs/index-health.js';
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

/** Bài + khách sạn → tỉnh cho bộ điều phối gợi ý. days: 1 vì chỉ cần tỉnh, không cần giá. */
const recommendCatalog = (commerce: CommerceFacade, content: ContentFacade): RecommendCatalog => ({
  listPosts: (cursor) => content.listPosts({ cursor, limit: 100 }),
  listHotelProvinces: async (cursor) => {
    const page = await commerce.listCatalog({ type: 'hotel', cursor, limit: 200, days: 1 });
    const items = page.items.filter((item): item is CatalogHotel => item.type === 'hotel').map((h) => ({ id: h.id, provinceSlug: h.province.slug }));
    return { items, nextCursor: page.nextCursor };
  },
  getVisiblePosts: (postIds) => content.getVisiblePosts(postIds),
});

/**
 * Module discovery. Chủ: Duy (backup Dũng). Xem README.md cùng thư mục.
 * Module khác chỉ dùng những gì được export trong index.ts. Gọi commerce, content qua facade (một chiều, trong tiến trình).
 */
@Module({
  imports: [CommerceModule, ContentModule],
  controllers: [
    SuggestController,
    StaysController,
    ExploreController,
    HomeRecommendationsController,
    PostRecommendationsController,
    AdminIndexHealthController,
  ],
  providers: [
    { provide: SUGGEST_STORE, inject: [DB_POOLS], useFactory: (pools: DbPools) => new DrizzleSuggestStore(createDb(pools.discovery)) },
    { provide: HOTEL_CATALOG, inject: [CommerceFacade], useFactory: commerceHotelCatalog },
    { provide: EXPLORE_STORE, inject: [DB_POOLS], useFactory: (pools: DbPools) => new DrizzleExploreStore(createDb(pools.discovery)) },
    { provide: EXPLORE_CATALOG, inject: [CommerceFacade, ContentFacade], useFactory: exploreCatalog },
    { provide: SEARCH_EVENT_BUS, inject: [REDIS], useFactory: (redis: Redis) => new RedisStreamsEventBus(redis) },
    SearchEventsPublisher,
    SuggestUseCases,
    StaysUseCases,
    HomeRecommendationUseCases,
    ExploreUseCases,
    IndexHealth,
    RebuildSuggestIndexJob,
    RebuildExploreIndexJob,
    { provide: RECOMMEND_STORE, inject: [DB_POOLS], useFactory: (pools: DbPools) => new DrizzleRecommendStore(createDb(pools.discovery)) },
    { provide: RECOMMEND_CATALOG, inject: [CommerceFacade, ContentFacade], useFactory: recommendCatalog },
    RecommendIngestUseCases,
    { provide: SERVED_STORE, inject: [REDIS], useFactory: (redis: Redis) => new RedisServedStore(redis) },
    BuildFeaturesUseCases,
    PostRecommendationUseCases,
    BuildFeaturesJob,
    PurgeInteractionsJob,
    DiscoveryEventsConsumer,
  ],
})
export class DiscoveryModule {}
