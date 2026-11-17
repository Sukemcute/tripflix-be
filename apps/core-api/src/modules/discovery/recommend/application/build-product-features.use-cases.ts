import { Inject, Injectable, Logger } from '@nestjs/common';
import { PLACES_STORE, type PlacesStore } from '../../search/application/ports.js';
import { flightProfileV0 } from '../domain/builders/flight-profile.js';
import { hotelProfileV0 } from '../domain/builders/hotel-profile.js';
import type { FlightBuilder, HotelBuilder, HotelPoint, ProductBuildOutput, ProductType } from '../domain/contracts.js';
import {
  PRODUCT_FEATURE_STORE,
  PRODUCT_PROFILE_CATALOG,
  RECOMMEND_STORE,
  type ProductFeatureStore,
  type ProductProfileCatalog,
  type RecommendStore,
} from './ports.js';

const LOCK = 'discovery.recommend-product-features';
/** Chặn vòng lặp nếu nguồn trả con trỏ lặp lại. */
const MAX_CATALOG_PAGES = 50;

/** Builder sản phẩm đang dùng: ranker trip_stays@v0 / trip_flights@v0 đọc hồ sơ của các khoá này. */
export const HOTEL_BUILDER: HotelBuilder = hotelProfileV0;
export const FLIGHT_BUILDER: FlightBuilder = flightProfileV0;

export interface ProductBuildResult {
  hotels: number;
  flights: number;
  /** Khoá builder lỗi (giữ hồ sơ cũ); rỗng khi ổn. */
  failedBuilders: string[];
}

async function readAll<T>(page: (cursor: string | null) => Promise<{ items: T[]; nextCursor: string | null }>): Promise<T[]> {
  const all: T[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < MAX_CATALOG_PAGES; i += 1) {
    const next = await page(cursor);
    all.push(...next.items);
    cursor = next.nextCursor;
    if (!cursor) break;
  }
  return all;
}

/**
 * Dựng hồ sơ sản phẩm commerce cho gợi ý phần còn thiếu (TF39): khách sạn (hotel_profile@v0) và chuyến bay
 * (flight_profile@v0) → thay toàn bộ recommend_product_features theo từng builder. Chạy trong job đặc trưng gợi ý
 * (mỗi 10 phút). Builder lỗi thì giữ hồ sơ cũ của builder đó, builder kia vẫn chạy.
 */
@Injectable()
export class BuildProductFeaturesUseCases {
  private readonly logger = new Logger(BuildProductFeaturesUseCases.name);

  constructor(
    @Inject(RECOMMEND_STORE) private readonly store: Pick<RecommendStore, 'withLock' | 'setJobState'>,
    @Inject(PRODUCT_FEATURE_STORE) private readonly features: ProductFeatureStore,
    @Inject(PRODUCT_PROFILE_CATALOG) private readonly catalog: ProductProfileCatalog,
    @Inject(PLACES_STORE) private readonly places: Pick<PlacesStore, 'listPoints'>,
  ) {}

  /** null = worker khác đang dựng, bỏ lượt. */
  runCycle(now = new Date()): Promise<ProductBuildResult | null> {
    return this.store.withLock(LOCK, () => this.build(now));
  }

  private async build(now: Date): Promise<ProductBuildResult> {
    const failedBuilders: string[] = [];
    const bookings = await this.features.countProductBookings(now);
    const booked = (productIds: string[]) => productIds.reduce((sum, id) => sum + (bookings.get(id) ?? 0), 0);

    const hotels = await this.runBuilder(HOTEL_BUILDER.key, 'hotel', now, failedBuilders, async () => {
      const [sources, points] = await Promise.all([readAll((c) => this.catalog.listHotelProfiles(c)), this.places.listPoints()]);
      return HOTEL_BUILDER.build(
        {
          hotels: sources.map((h) => ({
            hotelId: h.id,
            provinceSlug: h.provinceSlug,
            city: h.city,
            stars: h.stars,
            priceFrom: h.priceFrom,
            rating: h.rating,
            location: h.location,
            bookings30d: booked(h.roomProductIds),
          })),
          points: points.flatMap((p): HotelPoint[] => (p.kind === 'lodging' ? [] : [{ name: p.name, kind: p.kind, lat: p.lat, lng: p.lng }])),
        },
        now,
      );
    });

    const flights = await this.runBuilder(FLIGHT_BUILDER.key, 'flight', now, failedBuilders, async () => {
      const sources = await readAll((c) => this.catalog.listFlightProfiles(c));
      return FLIGHT_BUILDER.build({ flights: sources.map(({ cabinProductIds, ...f }) => ({ ...f, bookings30d: booked(cabinProductIds) })) }, now);
    });

    return { hotels, flights, failedBuilders };
  }

  /** Trả số sản phẩm đã dựng (0 khi lỗi hoặc danh mục rỗng: giữ hồ sơ cũ thay vì xoá sạch). */
  private async runBuilder(key: string, productType: ProductType, now: Date, failed: string[], build: () => Promise<ProductBuildOutput[]>): Promise<number> {
    const builder = productType === 'hotel' ? HOTEL_BUILDER : FLIGHT_BUILDER;
    try {
      const out = await build();
      for (const o of out) builder.featuresSchema.parse(o.features);
      if (out.length) await this.features.replaceProductFeatures(key, productType, out);
      await this.store.setJobState(key, { lastRunAt: now, lastError: null });
      return out.length;
    } catch (error) {
      failed.push(key);
      await this.store.setJobState(key, { lastRunAt: now, lastError: (error as Error).message.slice(0, 2000) });
      this.logger.error({ builder: key, err: error }, `Builder ${key} lỗi, giữ hồ sơ cũ`);
      return 0;
    }
  }
}
