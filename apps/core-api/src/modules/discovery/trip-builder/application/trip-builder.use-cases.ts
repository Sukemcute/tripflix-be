import { Inject, Injectable } from '@nestjs/common';
import { CommerceFacade, type CatalogFlight } from '../../../commerce/index.js';
import { StaysUseCases } from '../../search/application/stays.use-cases.js';
import { AIRPORTS } from '../../search/domain/airports.js';
import { resolvePlaceSlugs } from '../../search/domain/stays.js';
import {
  rankFlights,
  rankStays,
  type FlightCandidate,
  type FlightSort,
  type FlightSuggestion,
  type StaySuggestSort,
  type StaySuggestion,
} from '../domain/trip-builder.js';

export interface SuggestFlightsQuery {
  /** `refId` của dòng `place` trong /api/suggest: nơi đến. */
  place: string;
  /** Mã sân bay đi (nhà của khách). */
  from: string;
  /** Ngày bay chiều đi; `returnDate` trống thì chỉ có chiều đi. */
  departDate: string;
  returnDate?: string;
  adults: number;
  sort: FlightSort;
  limit: number;
}

export interface FlightSuggestions {
  outbound: FlightSuggestion[];
  inbound: FlightSuggestion[];
}

export interface SuggestStaysQuery {
  place: string;
  checkIn: string;
  checkOut: string;
  adults: number;
  sort: StaySuggestSort;
  limit: number;
}

/** Phần của CommerceFacade mà luồng này dùng; test truyền bản giả. */
export type TripBuilderCommerce = Pick<CommerceFacade, 'listCatalog' | 'checkAvailability'>;

const CATALOG_PAGE_SIZE = 200;
const AVAILABILITY_BATCH_SIZE = 100;
const MAX_CATALOG_PAGES = 20;
/** Lấy nhiều khách sạn còn phòng rồi tự xếp; app chỉ hiện vài lựa chọn đầu. */
const STAY_POOL_SIZE = 50;

/**
 * Gợi ý cho "Tự lên lộ trình" ở tab Đặt (TF105): vé bay hai chiều và chỗ ở cho một nơi, giá thật từ commerce.
 * Bản đầu chỉ xếp theo giá, giờ bay và điểm đánh giá (domain/trip-builder.ts); discovery thay cách xếp sau, hợp đồng giữ nguyên.
 * Nơi lạ hoặc sân bay lạ thì null (controller trả 400).
 */
@Injectable()
export class TripBuilderUseCases {
  constructor(
    @Inject(CommerceFacade) private readonly commerce: TripBuilderCommerce,
    @Inject(StaysUseCases) private readonly stays: StaysUseCases,
  ) {}

  async suggestFlights(query: SuggestFlightsQuery): Promise<FlightSuggestions | null> {
    const destinationSlugs = resolvePlaceSlugs(query.place);
    const home = AIRPORTS.find((airport) => airport.code === query.from);
    if (!destinationSlugs || !home) return null;
    const homeSlugs = resolvePlaceSlugs(home.placeId) ?? [home.placeId];

    const outboundFlights = (await this.listFlights(destinationSlugs)).filter((f) => f.fromAirport === query.from);
    const destinationAirports = new Set(outboundFlights.map((f) => f.toAirport));
    const inboundFlights = query.returnDate
      ? (await this.listFlights(homeSlugs)).filter(
          (f) => f.toAirport === query.from && destinationAirports.has(f.fromAirport),
        )
      : [];

    const [outbound, inbound] = await Promise.all([
      this.priceFlights(outboundFlights, query.departDate, query.adults),
      query.returnDate ? this.priceFlights(inboundFlights, query.returnDate, query.adults) : Promise.resolve([]),
    ]);
    return {
      outbound: rankFlights(outbound, 'outbound', query.sort).slice(0, query.limit),
      inbound: rankFlights(inbound, 'inbound', query.sort).slice(0, query.limit),
    };
  }

  async suggestStays(query: SuggestStaysQuery): Promise<StaySuggestion[] | null> {
    const page = await this.stays.listStays({
      placeId: query.place,
      checkIn: query.checkIn,
      checkOut: query.checkOut,
      adults: query.adults,
      sort: 'price',
      limit: STAY_POOL_SIZE,
    });
    if (!page) return null;
    const candidates = page.items.flatMap((stay) =>
      stay.roomProductId && stay.ratePlanCode
        ? [
            {
              hotelId: stay.hotelId,
              slug: stay.slug,
              name: stay.name,
              stars: stay.stars,
              thumbnail: stay.thumbnail,
              rating: stay.rating,
              roomProductId: stay.roomProductId,
              ratePlanCode: stay.ratePlanCode,
              unitPrice: stay.unitPrice,
              totalPrice: stay.totalPrice,
            },
          ]
        : [],
    );
    return rankStays(candidates, query.sort).slice(0, query.limit);
  }

  private async listFlights(provinceSlugs: readonly string[]): Promise<CatalogFlight[]> {
    const pages = await Promise.all(
      provinceSlugs.map(async (provinceSlug) => {
        const flights: CatalogFlight[] = [];
        let cursor: string | null = null;
        for (let page = 0; page < MAX_CATALOG_PAGES; page += 1) {
          const result = await this.commerce.listCatalog({ type: 'flight', provinceSlug, cursor, limit: CATALOG_PAGE_SIZE, days: 1 });
          flights.push(...result.items.filter((item): item is CatalogFlight => item.type === 'flight'));
          cursor = result.nextCursor;
          if (!cursor) break;
        }
        return flights;
      }),
    );
    return pages.flat();
  }

  /** Giá thật của hạng ghế rẻ nhất còn bán đúng ngày; chuyến hết chỗ thì bỏ. */
  private async priceFlights(flights: readonly CatalogFlight[], date: string, adults: number): Promise<FlightCandidate[]> {
    if (!flights.length) return [];
    const batches: CatalogFlight[][] = [];
    for (let i = 0; i < flights.length; i += AVAILABILITY_BATCH_SIZE) batches.push(flights.slice(i, i + AVAILABILITY_BATCH_SIZE));
    const availability = (
      await Promise.all(
        batches.map((batch) => this.commerce.checkAvailability({ productIds: batch.map((f) => f.id), checkIn: date, adults })),
      )
    ).flat();
    const byId = new Map(availability.map((a) => [a.productId, a]));
    return flights.flatMap((flight): FlightCandidate[] => {
      const a = byId.get(flight.id);
      if (!a?.isAvailable || !a.optionId || !a.ratePlanCode || a.unitPrice === null || a.totalPrice === null) return [];
      return [
        {
          flightId: flight.id,
          productId: a.optionId,
          ratePlanCode: a.ratePlanCode,
          name: flight.name,
          airline: flight.airline,
          fromAirport: flight.fromAirport,
          toAirport: flight.toAirport,
          departTime: flight.departTime,
          arriveTime: flight.arriveTime,
          unitPrice: a.unitPrice,
          totalPrice: a.totalPrice,
        },
      ];
    });
  }
}
