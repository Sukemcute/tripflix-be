import { Inject, Injectable } from '@nestjs/common';
import { CommerceFacade, type CatalogFlight, type CatalogHotel, type CatalogProductType } from '../../../commerce/index.js';
import { StaysUseCases } from '../../search/application/stays.use-cases.js';
import type { FlightProfileFeatures } from '../domain/builders/flight-profile.js';
import type { HotelProfileFeatures } from '../domain/builders/hotel-profile.js';
import type { BudgetLevel } from '../domain/rankers/budget-fit.js';
import { rankTripFlights, type TripFlightsResult } from '../domain/rankers/trip-flights.js';
import { rankTripStays, type TripStaysResult } from '../domain/rankers/trip-stays.js';
import { FLIGHT_BUILDER, HOTEL_BUILDER } from './build-product-features.use-cases.js';
import { PRODUCT_FEATURE_STORE, type ProductFeatureStore } from './ports.js';
import { AIRPORTS } from '../../search/domain/airports.js';
import { PLACES } from '../../search/domain/places.js';
import { airportsForPlace, pickOrigin, placesServedBy, planTripAddons, type AirportServes, type FlightQuote, type TripItem } from '../domain/trip-addons.js';

/** Phần của CommerceFacade mà luồng này dùng; test truyền bản giả. */
export type TripAddonCommerce = Pick<CommerceFacade, 'listCatalog' | 'checkAvailability'>;
export type TripAddonStays = Pick<StaysUseCases, 'listStays'>;
export type TripAddonProductFeatures = Pick<ProductFeatureStore, 'findProductFeatures'>;

export interface TripAddonQuery {
  items: TripItem[];
  adults: number;
  rooms?: number;
  /** Sân bay đi người dùng chọn cho vé gợi ý; bỏ trống hoặc không có chuyến thì tự chọn (SGN, HAN, ...). */
  fromAirport?: string | null;
  /** Mức chi phí người dùng chọn (travelPreferences.budgetLevels); bỏ trống thì ranker dùng mức mặc định. */
  budgetLevels?: BudgetLevel[] | null;
  /** Số mục mỗi nhóm tiêu chí. */
  perGroup: number;
}

export interface FlightAddons {
  /** Nơi của khách sạn trong đơn. */
  destination: { slug: string; name: string };
  /** Sân bay đi đang dùng; null khi không có chuyến nào tới nơi này. */
  fromAirport: string | null;
  /** Các sân bay có chuyến tới nơi này, cho ô "Bay từ". */
  origins: string[];
  departDate: string;
  returnDate: string;
  outbound: TripFlightsResult;
  inbound: TripFlightsResult;
}

export interface StayAddons extends TripStaysResult {
  place: { slug: string; name: string };
  checkIn: string;
  checkOut: string;
}

export interface TripAddons {
  /** Loại đang thiếu trong các mục đã chọn; null khi đủ cả hai hoặc chưa chọn gì. */
  missing: 'flight' | 'hotel' | null;
  flights: FlightAddons | null;
  stays: StayAddons | null;
}

const CATALOG_PAGE_SIZE = 200;
/** Chặn vòng lặp nếu nguồn trả con trỏ lặp lại. */
const MAX_CATALOG_PAGES = 50;
/** Giới hạn của commerce.checkAvailability. */
const AVAILABILITY_BATCH_SIZE = 100;
/** Khách sạn còn phòng đưa vào ranker. ponytail: lấy hết một tỉnh (~100 khách sạn) mỗi lượt; nhiều hơn thì cắt theo giá. */
const MAX_STAY_CANDIDATES = 300;

const servesOf = (flights: readonly CatalogFlight[]): AirportServes[] => flights.map((f) => ({ toAirport: f.toAirport, placeSlug: f.province.slug }));

/**
 * Gợi ý phần còn thiếu của chuyến (F10, TF39), gọi trước khi giữ chỗ: có phòng thì gợi ý vé khứ hồi tới nơi đó,
 * có vé thì gợi ý khách sạn còn phòng ở nơi đến. Xếp bằng ranker trip_flights@v0 / trip_stays@v0 trên hồ sơ
 * flight_profile@v0 / hotel_profile@v0 (job 10 phút).
 * Kết quả chia nhóm tiêu chí (giá, đánh giá, gần chỗ đi chơi...).
 * Chỉ đọc commerce qua facade; giá và chỗ là thật cho đúng ngày.
 */
@Injectable()
export class TripAddonUseCases {
  constructor(
    @Inject(CommerceFacade) private readonly commerce: TripAddonCommerce,
    @Inject(StaysUseCases) private readonly stays: TripAddonStays,
    @Inject(PRODUCT_FEATURE_STORE) private readonly productFeatures: TripAddonProductFeatures,
  ) {}

  async suggest(query: TripAddonQuery): Promise<TripAddons> {
    const plan = planTripAddons(query.items);
    if (plan.missing === 'flight') {
      return { missing: 'flight', flights: await this.suggestFlights(plan.hotelId, plan.returnHotelId, plan.departDate, plan.returnDate, query), stays: null };
    }
    if (plan.missing === 'hotel') {
      return { missing: 'hotel', flights: null, stays: await this.suggestStays(plan.toAirport, plan.checkIn, plan.checkOut, query) };
    }
    return { missing: null, flights: null, stays: null };
  }

  /** Khách sạn lạ (đã gỡ khỏi danh mục) thì null: không biết nơi để gợi ý. */
  private async suggestFlights(hotelId: string, returnHotelId: string, departDate: string, returnDate: string, query: TripAddonQuery): Promise<FlightAddons | null> {
    const [hotels, flights] = await Promise.all([this.readCatalog<CatalogHotel>('hotel'), this.readCatalog<CatalogFlight>('flight')]);
    const hotel = hotels.find((h) => h.id === hotelId);
    if (!hotel) return null;
    const returnHotel = hotels.find((h) => h.id === returnHotelId) ?? hotel;

    const serves = servesOf(flights);
    const toAirports = new Set(airportsForPlace(hotel.province.slug, serves));
    // Chiều về bay từ nơi ở cuối (khác nơi đầu khi đơn có hai khách sạn ở hai nơi).
    const backAirports = new Set(airportsForPlace(returnHotel.province.slug, serves));
    const origins = [...new Set(flights.filter((f) => toAirports.has(f.toAirport)).map((f) => f.fromAirport))].filter((code) => !toAirports.has(code)).sort();
    const fromAirport = pickOrigin(origins, query.fromAirport);

    const outbound = flights.filter((f) => f.fromAirport === fromAirport && toAirports.has(f.toAirport));
    const inbound = flights.filter((f) => backAirports.has(f.fromAirport) && f.toAirport === fromAirport);
    const [outQuotes, inQuotes] = await Promise.all([this.quoteFlights(outbound, departDate, query.adults), this.quoteFlights(inbound, returnDate, query.adults)]);
    const profiles = await this.productFeatures.findProductFeatures(FLIGHT_BUILDER.key, [...outQuotes, ...inQuotes].map((q) => q.flightKey));
    const withProfiles = (quotes: FlightQuote[]) => quotes.map((q) => ({ ...q, profile: (profiles.get(q.flightKey)?.features as FlightProfileFeatures | undefined) ?? null }));
    return {
      destination: hotel.province,
      fromAirport,
      origins,
      departDate,
      returnDate,
      outbound: rankTripFlights({ candidates: withProfiles(outQuotes), leg: 'outbound', budgetLevels: query.budgetLevels, perGroup: query.perGroup }),
      inbound: rankTripFlights({ candidates: withProfiles(inQuotes), leg: 'inbound', budgetLevels: query.budgetLevels, perGroup: query.perGroup }),
    };
  }

  /** Sân bay không có trong danh mục chuyến bay thì null. */
  private async suggestStays(toAirport: string, checkIn: string, checkOut: string, query: TripAddonQuery): Promise<StayAddons | null> {
    const serves = servesOf(await this.readCatalog<CatalogFlight>('flight'));
    const served = placesServedBy(toAirport, serves);
    if (!served.length) return null;
    // Khách sạn ở các nơi sân bay phục vụ, và chỉ khi sân bay gần khách sạn đó đúng là sân bay này (VCS → Côn Đảo, không cả TP.HCM).
    const pages = await Promise.all(
      served.map((placeId) => this.stays.listStays({ placeId, checkIn, checkOut, adults: query.adults, rooms: query.rooms, sort: 'price', limit: MAX_STAY_CANDIDATES })),
    );
    const byId = new Map(pages.flatMap((page) => page?.items ?? []).map((s) => [s.hotelId, s]));
    const items = [...byId.values()]
      .filter((s) => airportsForPlace(s.province.slug, serves).includes(toAirport))
      .sort((a, b) => a.unitPrice - b.unitPrice)
      .slice(0, MAX_STAY_CANDIDATES);
    const profiles = await this.productFeatures.findProductFeatures(HOTEL_BUILDER.key, items.map((s) => s.hotelId));
    const grouped = rankTripStays({
      candidates: items.map((s) => ({ ...s, profile: (profiles.get(s.hotelId)?.features as HotelProfileFeatures | undefined) ?? null })),
      budgetLevels: query.budgetLevels,
      perGroup: query.perGroup,
    });
    // Tên nơi theo sân bay (CXR → Nha Trang, SGN → TP. Hồ Chí Minh); sân bay lạ thì nơi đầu tiên nó phục vụ.
    const placeSlug = AIRPORTS.find((a) => a.code === toAirport)?.placeId ?? served[0]!;
    const name = PLACES.find((p) => p.id === placeSlug)?.name ?? placeSlug;
    return { place: { slug: placeSlug, name }, checkIn, checkOut, ...grouped };
  }

  private async quoteFlights(flights: readonly CatalogFlight[], date: string, adults: number): Promise<FlightQuote[]> {
    const batches: CatalogFlight[][] = [];
    for (let i = 0; i < flights.length; i += AVAILABILITY_BATCH_SIZE) batches.push(flights.slice(i, i + AVAILABILITY_BATCH_SIZE));
    // Gửi mã chuyến: commerce trả hạng ghế rẻ nhất còn chỗ trong ngày (optionId) và giá thật cho số khách.
    const results = (await Promise.all(batches.map((batch) => this.commerce.checkAvailability({ productIds: batch.map((f) => f.id), checkIn: date, adults })))).flat();
    const byId = new Map(flights.map((f) => [f.id, f]));
    return results.flatMap((a): FlightQuote[] => {
      const f = byId.get(a.productId);
      if (!f || !a.isAvailable || !a.optionId || a.unitPrice === null || a.totalPrice === null) return [];
      return [
        {
          flightKey: f.id,
          productId: a.optionId,
          ratePlanCode: a.ratePlanCode ?? '',
          name: f.name,
          airline: f.airline,
          fromAirport: f.fromAirport,
          toAirport: f.toAirport,
          date,
          departTime: f.departTime,
          arriveTime: f.arriveTime,
          unitPrice: a.unitPrice,
          totalPrice: a.totalPrice,
        },
      ];
    });
  }

  /** Cả danh mục một loại. CommerceFacade.listCatalog đã nhớ kết quả, nên mỗi lượt gợi ý không đọc lại database. */
  private async readCatalog<T extends CatalogHotel | CatalogFlight>(type: CatalogProductType): Promise<T[]> {
    const items: T[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < MAX_CATALOG_PAGES; page += 1) {
      const result = await this.commerce.listCatalog({ type, cursor, limit: CATALOG_PAGE_SIZE, days: 1 });
      items.push(...result.items.filter((item): item is T => item.type === type));
      cursor = result.nextCursor;
      if (!cursor) break;
    }
    return items;
  }
}
