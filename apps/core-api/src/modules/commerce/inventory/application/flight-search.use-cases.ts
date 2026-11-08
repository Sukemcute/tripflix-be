import { Inject, Injectable } from '@nestjs/common';
import { CommerceError } from '../domain/errors.js';
import { addDays, calculatePassengerFares, countNights, findPassengerMixError, isIsoDate, quoteFlight, type PassengerMix, type UnavailableReason } from '../domain/sales-rules.js';
import { COMMERCE_STORE, TODAY, type CommerceStore, type FlightRecord, type FlightRouteRecord, type Today } from './ports.js';

const DEFAULT_PASSENGERS = 1;
const AIRPORT_CODE = /^[A-Z]{3}$/;
const MAX_CALENDAR_DAYS = 31;

export const FLIGHT_SORTS = ['recommended', 'price', 'departure', 'duration'] as const;
export type FlightSort = (typeof FLIGHT_SORTS)[number];

/** passengers là số người lớn; trẻ em (2–11 tuổi) chiếm ghế, em bé (dưới 2 tuổi) ngồi lòng người lớn. */
interface PassengerQuery {
  passengers?: number;
  children?: number;
  infants?: number;
}

export interface FlightSearchQuery extends PassengerQuery {
  from: string;
  to: string;
  date: string;
  /** recommended (mặc định): còn ghế trước, rồi giờ bay, rồi giá. */
  sort?: FlightSort;
}

export interface FlightCalendarQuery extends PassengerQuery {
  from: string;
  to: string;
  /** Ngày đầu và ngày cuối (tính cả hai), tối đa 31 ngày. */
  start: string;
  end: string;
}

export interface FlightCalendarResult {
  query: { from: string; to: string; start: string; end: string; passengers: number };
  /** Giá một vé rẻ nhất của từng ngày trên tuyến; null khi ngày đó không còn chuyến nào đủ ghế. */
  days: { date: string; priceFrom: number | null; isAvailable: boolean }[];
}

export interface FlightOfferQuery extends PassengerQuery {
  date: string;
}

export interface FlightFareQuote {
  code: string;
  name: string;
  isRefundable: boolean;
  freeCancelDays: number;
  /** Giá một vé người lớn; null khi hạng ghế không bán được ngày này. */
  pricePerPerson: number | null;
  /** Giá một vé trẻ em (75%) và em bé (10%); null khi không bán được. */
  childPrice: number | null;
  infantPrice: number | null;
  /** Cả nhóm hành khách (người lớn, trẻ em, em bé); null khi không bán được. */
  totalPrice: number | null;
  /** Hành lý xách tay và ký gửi, kg mỗi khách; null khi dữ liệu chưa có. */
  carryOnKg: number | null;
  checkedKg: number | null;
}

/** Một hạng ghế của một chuyến bay, đúng ngày và số khách đang tìm. productId dùng thẳng cho POST /checkout. */
export interface FlightOffer {
  productId: string;
  flightKey: string;
  name: string;
  airline: string | null;
  /** Mã IATA của hãng (VJ, VN...) để gắn logo. */
  airlineCode: string | null;
  /** Số hiệu chuyến, ví dụ VJ141. */
  flightNumber: string | null;
  fromAirport: string;
  toAirport: string;
  departTime: string | null;
  arriveTime: string | null;
  /** Thời gian bay (phút); null khi thiếu giờ đi hoặc giờ đến. */
  durationMinutes: number | null;
  /** Số điểm dừng; 0 là bay thẳng. */
  stops: number;
  cabinCode: string | null;
  cabinName: string;
  destination: { slug: string; name: string };
  isAvailable: boolean;
  reason: UnavailableReason | null;
  /** Số ghế thật còn lại ngày đó. */
  remaining: number | null;
  /** Giá một vé rẻ nhất trong các gói; null khi không bán được. */
  priceFrom: number | null;
  /** Giá đã gồm thuế, phí. */
  isPriceTaxIncluded: boolean;
  fares: FlightFareQuote[];
}

export interface FlightSearchResult {
  query: { from: string; to: string; date: string; passengers: number };
  flights: FlightOffer[];
}

/** Phút bay từ giờ đi tới giờ đến (HH:MM); qua nửa đêm thì cộng một ngày. */
function countFlightMinutes(departTime: string | null, arriveTime: string | null): number | null {
  if (!departTime || !arriveTime) return null;
  const toMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  return (toMinutes(arriveTime) - toMinutes(departTime) + 24 * 60) % (24 * 60);
}

type CompareOffers = (a: FlightOffer, b: FlightOffer) => number;
const byDeparture: CompareOffers = (a, b) => (a.departTime ?? '').localeCompare(b.departTime ?? '');
const byPrice: CompareOffers = (a, b) => (a.priceFrom ?? Infinity) - (b.priceFrom ?? Infinity);
const byDuration: CompareOffers = (a, b) => (a.durationMinutes ?? Infinity) - (b.durationMinutes ?? Infinity);
const byAvailable: CompareOffers = (a, b) => Number(b.isAvailable) - Number(a.isAvailable);

/** Chuyến hết ghế luôn xuống cuối; trong nhóm còn ghế thì xếp theo lựa chọn. */
function compareOffers(sort: FlightSort): CompareOffers {
  const order: Record<FlightSort, CompareOffers[]> = { recommended: [byDeparture, byPrice], price: [byPrice, byDeparture], departure: [byDeparture, byPrice], duration: [byDuration, byPrice] };
  return (a, b) => byAvailable(a, b) || order[sort].reduce((result, compare) => result || compare(a, b), 0);
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
    const mix = this.validate(query);
    const flights = await this.store.catalog.findFlightsByRoute(from, to);
    const sort = query.sort ?? 'recommended';
    if (!FLIGHT_SORTS.includes(sort)) throw new CommerceError('invalid_query', `sort là một trong ${FLIGHT_SORTS.join(', ')}.`, 'sort');
    const offers = await this.quote(flights, query.date, mix);
    offers.sort(compareOffers(sort));
    return { query: { from, to, date: query.date, passengers: mix.adults }, flights: offers };
  }

  /** Giá một vé rẻ nhất từng ngày trên tuyến, để vẽ dải ngày "From 1.804k". Một lần đọc lịch cho cả khoảng. */
  async getPriceCalendar(query: FlightCalendarQuery): Promise<FlightCalendarResult> {
    const from = query.from.toUpperCase();
    const to = query.to.toUpperCase();
    if (!AIRPORT_CODE.test(from)) throw new CommerceError('invalid_query', 'Mã sân bay đi gồm 3 chữ cái, ví dụ SGN.', 'from');
    if (!AIRPORT_CODE.test(to)) throw new CommerceError('invalid_query', 'Mã sân bay đến gồm 3 chữ cái, ví dụ CXR.', 'to');
    if (from === to) throw new CommerceError('invalid_query', 'Sân bay đi và đến phải khác nhau.', 'to');
    const mix = this.validate({ ...query, date: query.start }, 'start');
    if (!isIsoDate(query.end) || query.end < query.start || countNights(query.start, query.end) + 1 > MAX_CALENDAR_DAYS) {
      throw new CommerceError('invalid_query', `Ngày cuối phải từ ngày đầu trở đi, tối đa ${MAX_CALENDAR_DAYS} ngày.`, 'end');
    }
    const flights = await this.store.catalog.findFlightsByRoute(from, to);
    const days = await this.store.calendar.loadFlightDays(flights.map((f) => f.id), query.start, query.end);
    const dates = Array.from({ length: countNights(query.start, query.end) + 1 }, (_, i) => addDays(query.start, i));
    return {
      query: { from, to, start: query.start, end: query.end, passengers: mix.adults },
      days: dates.map((date) => {
        const prices = flights.flatMap((flight) => {
          const day = days.get(flight.id)?.find((d) => d.date === date);
          return flight.farePlans.flatMap((plan) => {
            const quote = quoteFlight({ day, passengers: mix.adults, children: mix.children, infants: mix.infants, plan });
            return quote.isAvailable ? [quote.pricePerNight] : [];
          });
        });
        return { date, priceFrom: prices.length ? Math.min(...prices) : null, isAvailable: prices.length > 0 };
      }),
    };
  }

  async getFlightOffer(productId: string, query: FlightOfferQuery): Promise<FlightOffer> {
    const mix = this.validate(query);
    const [flight] = await this.store.catalog.findFlightsByIds([productId]);
    if (!flight) throw new CommerceError('not_found', 'Không có chuyến bay này.');
    return (await this.quote([flight], query.date, mix))[0]!;
  }

  private validate(query: PassengerQuery & { date: string }, dateField = 'date'): PassengerMix {
    const mix = { adults: query.passengers ?? DEFAULT_PASSENGERS, children: query.children ?? 0, infants: query.infants ?? 0 };
    if (!isIsoDate(query.date) || query.date < this.today()) throw new CommerceError('invalid_query', 'Ngày bay phải từ hôm nay trở đi.', dateField);
    const error = findPassengerMixError(mix);
    // Lỗi số người lớn trả về trường passengers, đúng tên tham số của API tìm chuyến.
    if (error) throw new CommerceError('invalid_query', error.message, error.field === 'adults' ? 'passengers' : error.field);
    return mix;
  }

  private async quote(flights: FlightRecord[], date: string, mix: PassengerMix): Promise<FlightOffer[]> {
    const days = await this.store.calendar.loadFlightDays(flights.map((f) => f.id), date, date);
    return flights.map((flight): FlightOffer => {
      const day = days.get(flight.id)?.[0];
      const quotes = flight.farePlans.map((plan) => {
        const quote = quoteFlight({ day, passengers: mix.adults, children: mix.children, infants: mix.infants, plan });
        return { plan, quote, fares: quote.isAvailable ? calculatePassengerFares(quote.pricePerNight) : null };
      });
      const first = quotes[0]?.quote;
      const prices = quotes.flatMap(({ quote }) => (quote.isAvailable ? [quote.pricePerNight] : []));
      return {
        productId: flight.id,
        flightKey: flight.flightKey,
        name: flight.name,
        airline: flight.airline,
        airlineCode: flight.airlineCode ?? null,
        flightNumber: flight.flightNumber ?? null,
        fromAirport: flight.fromAirport,
        toAirport: flight.toAirport,
        departTime: flight.departTime,
        arriveTime: flight.arriveTime,
        durationMinutes: countFlightMinutes(flight.departTime, flight.arriveTime),
        stops: flight.stops ?? 0,
        cabinCode: flight.cabinCode ?? null,
        cabinName: flight.cabinName,
        destination: { slug: flight.destinationSlug, name: flight.destinationName },
        isAvailable: first?.isAvailable ?? false,
        reason: first && !first.isAvailable ? first.reason : null,
        remaining: first ? (first.remaining ?? null) : null,
        priceFrom: prices.length ? Math.min(...prices) : null,
        isPriceTaxIncluded: true,
        fares: quotes.map(({ plan, quote, fares }) => ({
          code: plan.code,
          name: plan.name,
          isRefundable: plan.refundable,
          freeCancelDays: plan.freeCancelDays,
          pricePerPerson: quote.isAvailable ? quote.pricePerNight : null,
          childPrice: fares?.child ?? null,
          infantPrice: fares?.infant ?? null,
          totalPrice: quote.isAvailable ? quote.totalPrice : null,
          carryOnKg: plan.carryOnKg ?? null,
          checkedKg: plan.checkedKg ?? null,
        })),
      };
    });
  }
}
