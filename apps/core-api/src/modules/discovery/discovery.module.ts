import { Module } from '@nestjs/common';
import { createDb } from '@tripflix/db';
import { RedisStreamsEventBus } from '@tripflix/event-bus';
import type { Redis } from 'ioredis';
import type { CoreEnv } from '../../platform/env.js';
import { CORE_ENV, DB_POOLS, REDIS, type DbPools } from '../../platform/tokens.js';
import { AccessFacade, AccessModule } from '../access/index.js';
import { CommerceFacade, CommerceModule, type CatalogFlight, type CatalogHotel } from '../commerce/index.js';
import { ContentFacade, ContentModule, FeedFacade } from '../content/index.js';
import { DiscoveryEventsConsumer } from './consumers/discovery-events.consumer.js';
import { HomeRecommendationsController } from './recommend/api/home-recommendations.controller.js';
import { PostRecommendationsController } from './recommend/api/post-recommendations.controller.js';
import { TripAddonsController } from './recommend/api/trip-addons.controller.js';
import { HomeRecommendationUseCases } from './recommend/application/home-recommendations.use-cases.js';
import { BuildFeaturesUseCases } from './recommend/application/build-features.use-cases.js';
import { RecommendIngestUseCases } from './recommend/application/ingest.use-cases.js';
import { BuildProductFeaturesUseCases } from './recommend/application/build-product-features.use-cases.js';
import {
  PRODUCT_FEATURE_STORE,
  PRODUCT_PROFILE_CATALOG,
  RECENT_POSTS_STORE,
  RECOMMEND_CATALOG,
  RECOMMEND_STORE,
  SERVED_STORE,
  TEXT_EMBEDDER,
  type ProductProfileCatalog,
  type RecommendCatalog,
  type RecommendReelCard,
} from './recommend/application/ports.js';
import { PostRecommendationUseCases } from './recommend/application/post-recommendations.use-cases.js';
import { TripAddonUseCases } from './recommend/application/trip-addons.use-cases.js';
import { AiEmbeddingClient } from './recommend/infra/ai-embedding.client.js';
import { DrizzleRecommendStore } from './recommend/infra/drizzle-recommend.store.js';
import { RedisRecentPostsStore } from './recommend/infra/redis-recent-posts.store.js';
import { RedisServedStore } from './recommend/infra/redis-served.store.js';
import { BuildFeaturesJob } from './recommend/jobs/build-features.job.js';
import { PurgeInteractionsJob } from './recommend/jobs/purge-interactions.job.js';
import { AdminIndexHealthController } from './search/api/admin-index-health.controller.js';
import { AdminVocabGapsController } from './search/api/admin-vocab-gaps.controller.js';
import { AdminDiscoveryJobsController } from './jobs/admin-discovery-jobs.controller.js';
import { JobRuns } from './jobs/job-runs.js';
import { ExploreController } from './search/api/explore.controller.js';
import { StaysController } from './search/api/stays.controller.js';
import { SuggestController } from './search/api/suggest.controller.js';
import { PlacesController } from './search/api/places.controller.js';
import { PlacesUseCases } from './search/application/places.use-cases.js';
import { DrizzlePlacesStore } from './search/infra/drizzle-places.store.js';
import { LoadPlacesJob } from './search/jobs/load-places.job.js';
import { ExploreUseCases } from './search/application/explore.use-cases.js';
import {
  EXPLORE_CATALOG,
  PLACES_STORE,
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
      .map(({ id, slug, name, province, stars }) => ({ id, slug, name, province, stars }));
    return { items, nextCursor: page.nextCursor };
  },
});

/** Khách sạn + bài cho tìm khám phá. days: 30 để priceFrom là giá thấp nhất 30 ngày tới. */
const exploreCatalog = (commerce: CommerceFacade, content: ContentFacade, access: AccessFacade): ExploreCatalog => ({
  listHotels: async (cursor) => {
    const page = await commerce.listCatalog({ type: 'hotel', cursor, limit: 200, days: 30 });
    return { items: page.items.filter((item): item is CatalogHotel => item.type === 'hotel'), nextCursor: page.nextCursor };
  },
  listPosts: (cursor) => content.listPosts({ cursor, limit: 100 }),
  findVisiblePostIds: async (postIds) => new Set((await content.getVisiblePosts(postIds)).map((p) => p.id)),
  getAuthorNames: (authorIds) => access.getDisplayNames(authorIds),
});

/** Bài + khách sạn → tỉnh cho bộ điều phối gợi ý. days: 1 vì chỉ cần tỉnh, không cần giá. */
const recommendCatalog = (commerce: CommerceFacade, content: ContentFacade, feed: FeedFacade): RecommendCatalog => ({
  listPosts: (cursor) => content.listPosts({ cursor, limit: 100 }),
  listHotelProvinces: async (cursor) => {
    const page = await commerce.listCatalog({ type: 'hotel', cursor, limit: 200, days: 1 });
    const items = page.items.filter((item): item is CatalogHotel => item.type === 'hotel').map((h) => ({ id: h.id, provinceSlug: h.province.slug }));
    return { items, nextCursor: page.nextCursor };
  },
  getVisiblePosts: (postIds) => content.getVisiblePosts(postIds),
  getReelCardsByIds: async (postIds, viewerId) => (await feed.getByIds(postIds, viewerId)).items as unknown as RecommendReelCard[],
});

/** Khách sạn, chuyến bay cho hồ sơ gợi ý phần còn thiếu (TF39). days: 30 để priceFrom là giá thấp nhất 30 ngày tới. */
const productProfileCatalog = (commerce: CommerceFacade): ProductProfileCatalog => ({
  listHotelProfiles: async (cursor) => {
    const page = await commerce.listCatalog({ type: 'hotel', cursor, limit: 200, days: 30 });
    const items = page.items
      .filter((item): item is CatalogHotel => item.type === 'hotel')
      .map((h) => ({
        id: h.id,
        provinceSlug: h.province.slug,
        city: h.city,
        stars: h.stars,
        priceFrom: h.priceFrom,
        rating: h.rating ?? null,
        location: h.location,
        roomProductIds: h.options.map((o) => o.productId),
      }));
    return { items, nextCursor: page.nextCursor };
  },
  listFlightProfiles: async (cursor) => {
    const page = await commerce.listCatalog({ type: 'flight', cursor, limit: 200, days: 30 });
    const items = page.items
      .filter((item): item is CatalogFlight => item.type === 'flight')
      .map((f) => ({
        flightKey: f.id,
        fromAirport: f.fromAirport,
        toAirport: f.toAirport,
        airline: f.airline,
        departTime: f.departTime,
        arriveTime: f.arriveTime,
        priceFrom: f.priceFrom,
        hasRefundableFare: f.options.some((o) => o.ratePlans.some((p) => p.isRefundable)),
        cabinProductIds: f.options.map((o) => o.productId),
      }));
    return { items, nextCursor: page.nextCursor };
  },
});

/**
 * Module discovery. Chủ: Duy (backup Dũng). Xem README.md cùng thư mục.
 * Module khác chỉ dùng những gì được export trong index.ts. Gọi commerce, content, access qua facade (một chiều, trong tiến trình).
 */
@Module({
  imports: [CommerceModule, ContentModule, AccessModule],
  controllers: [
    SuggestController,
    PlacesController,
    StaysController,
    ExploreController,
    HomeRecommendationsController,
    PostRecommendationsController,
    TripAddonsController,
    AdminIndexHealthController,
    AdminVocabGapsController,
    AdminDiscoveryJobsController,
  ],
  providers: [
    { provide: SUGGEST_STORE, inject: [DB_POOLS], useFactory: (pools: DbPools) => new DrizzleSuggestStore(createDb(pools.discovery)) },
    { provide: HOTEL_CATALOG, inject: [CommerceFacade], useFactory: commerceHotelCatalog },
    { provide: EXPLORE_STORE, inject: [DB_POOLS], useFactory: (pools: DbPools) => new DrizzleExploreStore(createDb(pools.discovery)) },
    { provide: PLACES_STORE, inject: [DB_POOLS], useFactory: (pools: DbPools) => new DrizzlePlacesStore(createDb(pools.discovery)) },
    PlacesUseCases,
    LoadPlacesJob,
    { provide: EXPLORE_CATALOG, inject: [CommerceFacade, ContentFacade, AccessFacade], useFactory: exploreCatalog },
    { provide: SEARCH_EVENT_BUS, inject: [REDIS], useFactory: (redis: Redis) => new RedisStreamsEventBus(redis) },
    SearchEventsPublisher,
    SuggestUseCases,
    StaysUseCases,
    HomeRecommendationUseCases,
    ExploreUseCases,
    IndexHealth,
    JobRuns,
    RebuildSuggestIndexJob,
    RebuildExploreIndexJob,
    { provide: RECOMMEND_STORE, inject: [DB_POOLS], useFactory: (pools: DbPools) => new DrizzleRecommendStore(createDb(pools.discovery)) },
    { provide: RECOMMEND_CATALOG, inject: [CommerceFacade, ContentFacade, FeedFacade], useFactory: recommendCatalog },
    RecommendIngestUseCases,
    { provide: SERVED_STORE, inject: [REDIS], useFactory: (redis: Redis) => new RedisServedStore(redis) },
    { provide: RECENT_POSTS_STORE, inject: [REDIS], useFactory: (redis: Redis) => new RedisRecentPostsStore(redis) },
    {
      provide: TEXT_EMBEDDER,
      inject: [CORE_ENV],
      useFactory: (env: CoreEnv) =>
        new AiEmbeddingClient({ aiUrl: env.AI_SERVICE_URL, coreUrl: env.CORE_API_INTERNAL_URL, secret: env.MODERATION_SERVICE_CLIENT_SECRET }),
    },
    BuildFeaturesUseCases,
    { provide: PRODUCT_PROFILE_CATALOG, inject: [CommerceFacade], useFactory: productProfileCatalog },
    { provide: PRODUCT_FEATURE_STORE, useExisting: RECOMMEND_STORE },
    BuildProductFeaturesUseCases,
    PostRecommendationUseCases,
    TripAddonUseCases,
    BuildFeaturesJob,
    PurgeInteractionsJob,
    DiscoveryEventsConsumer,
  ],
})
export class DiscoveryModule {}
