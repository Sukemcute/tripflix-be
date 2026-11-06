import { Inject, Injectable } from '@nestjs/common';
import { CommerceError } from '../domain/errors.js';
import { MAX_ADULTS, isIsoDate, quoteFlight, type UnavailableReason } from '../domain/sales-rules.js';
import { COMMERCE_STORE, TODAY, type CommerceStore, type FlightRecord, type FlightRouteRecord, type Today } from './ports.js';

const DEFAULT_PASSENGERS = 1;
const AIRPORT_CODE = /^[A-Z]{3}$/;

export interface FlightSearchQuery {
  from: string;
  to: string;
  date: string;
  passengers?: number;
}

export interface FlightOfferQuery {
  date: string;
  passengers?: number;
}

export interface FlightFareQuote {
  code: string;
  name: string;
  isRefundable: boolean;
  freeCancelDays: number;
  /** Giá một vé; null khi hạng ghế không bán được ngày này. */
  pricePerPerson: number | null;
  /** Cả nhóm hành khách; null khi không bán được. */
  totalPrice: number | null;
}

/** Một hạng ghế của một chuyến bay, đúng ngày và số khách đang tìm. productId dùng thẳng cho POST /checkout. */
export interface FlightOffer {
  productId: string;
  flightKey: string;
  name: string;
  airline: string | null;
  fromAirport: string;
  toAirport: string;
  departTime: string | null;
  arriveTime: string | null;
  cabinName: string;
  destination: { slug: string; name: string };
  isAvailable: boolean;
  reason: UnavailableReason | null;
  /** Số ghế thật còn lại ngày đó. */
  remaining: number | null;
  /** Giá một vé rẻ nhất trong các gói; null khi không bán được. */
  priceFrom: number | null;
  fares: FlightFareQuote[];
}

export interface FlightSearchResult {
  query: { from: string; to: string; date: string; passengers: number };
  flights: FlightOffer[];
}

/** Tìm chuyến bay còn ghế cho người dùng (web, app). Công khai, chỉ đọc; đặt vé đi qua /checkout như khách sạn. */
@Injectable()
export class FlightSearchUseCases {
  constructor(
    @Inject(COMMERCE_STORE) private readonly store: CommerceStore,
    @Inject(TODAY) private readonly today: Today,
  ) {}

  listRoutes(): Promise<FlightRouteRecord[]> {
    return this.store.catalog.listFlightRoutes();
  }

  async searchFlights(query: FlightSearchQuery): Promise<FlightSearchResult> {
    const from = query.from.toUpperCase();
    const to = query.to.toUpperCase();
    if (!AIRPORT_CODE.test(from)) throw new CommerceError('invalid_query', 'Mã sân bay đi gồm 3 chữ cái, ví dụ SGN.', 'from');
    if (!AIRPORT_CODE.test(to)) throw new CommerceError('invalid_query', 'Mã sân bay đến gồm 3 chữ cái, ví dụ CXR.', 'to');
    if (from === to) throw new CommerceError('invalid_query', 'Sân bay đi và đến phải khác nhau.', 'to');
    const passengers = this.validate(query);
    const flights = await this.store.catalog.findFlightsByRoute(from, to);
    const offers = await this.quote(flights, query.date, passengers);
    // Chuyến còn ghế lên trước, rồi theo giờ bay, rồi giá.
    offers.sort((a, b) => Number(b.isAvailable) - Number(a.isAvailable) || (a.departTime ?? '').localeCompare(b.departTime ?? '') || (a.priceFrom ?? Infinity) - (b.priceFrom ?? Infinity));
    return { query: { from, to, date: query.date, passengers }, flights: offers };
  }

  async getFlightOffer(productId: string, query: FlightOfferQuery): Promise<FlightOffer> {
    const passengers = this.validate(query);
    const [flight] = await this.store.catalog.findFlightsByIds([productId]);
    if (!flight) throw new CommerceError('not_found', 'Không có chuyến bay này.');
    return (await this.quote([flight], query.date, passengers))[0]!;
  }

  private validate(query: { date: string; passengers?: number }): number {
    const passengers = query.passengers ?? DEFAULT_PASSENGERS;
    if (!isIsoDate(query.date) || query.date < this.today()) throw new CommerceError('invalid_query', 'Ngày bay phải từ hôm nay trở đi.', 'date');
    if (!Number.isInteger(passengers) || passengers < 1 || passengers > MAX_ADULTS) throw new CommerceError('invalid_query', `Số hành khách từ 1 đến ${MAX_ADULTS}.`, 'passengers');
    return passengers;
  }

  private async quote(flights: FlightRecord[], date: string, passengers: number): Promise<FlightOffer[]> {
    const days = await this.store.calendar.loadFlightDays(flights.map((f) => f.id), date, date);
    return flights.map((flight): FlightOffer => {
      const day = days.get(flight.id)?.[0];
      const quotes = flight.farePlans.map((plan) => ({ plan, quote: quoteFlight({ day, passengers, plan }) }));
      const first = quotes[0]?.quote;
      const prices = quotes.flatMap(({ quote }) => (quote.isAvailable ? [quote.pricePerNight] : []));
      return {
        productId: flight.id,
        flightKey: flight.flightKey,
        name: flight.name,
        airline: flight.airline,
        fromAirport: flight.fromAirport,
        toAirport: flight.toAirport,
        departTime: flight.departTime,
        arriveTime: flight.arriveTime,
        cabinName: flight.cabinName,
        destination: { slug: flight.destinationSlug, name: flight.destinationName },
        isAvailable: first?.isAvailable ?? false,
        reason: first && !first.isAvailable ? first.reason : null,
        remaining: first ? (first.remaining ?? null) : null,
        priceFrom: prices.length ? Math.min(...prices) : null,
        fares: quotes.map(({ plan, quote }) => ({
          code: plan.code,
          name: plan.name,
          isRefundable: plan.refundable,
          freeCancelDays: plan.freeCancelDays,
          pricePerPerson: quote.isAvailable ? quote.pricePerNight : null,
          totalPrice: quote.isAvailable ? quote.totalPrice : null,
        })),
      };
    });
  }
}
