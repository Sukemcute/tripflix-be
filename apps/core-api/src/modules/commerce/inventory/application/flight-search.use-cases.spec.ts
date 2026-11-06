import { describe, expect, it } from 'vitest';
import { CommerceError } from '../domain/errors.js';
import { MemoryCommerceStore } from '../infra/memory/memory-commerce.store.js';
import { CalendarUseCases } from './calendar.use-cases.js';
import { FlightSearchUseCases } from './flight-search.use-cases.js';

const TODAY = '2026-12-01';
const DATE = '2026-12-05';
const fares = [
  { code: 'ECO', name: 'Tiết kiệm', meal: 'none', refundable: false, freeCancelDays: 0, priceFactor: 1 },
  { code: 'FLEX', name: 'Linh hoạt', meal: 'none', refundable: true, freeCancelDays: 1, priceFactor: 1.3 },
];
const base = { airline: 'VN', arriveTime: null, destinationSlug: 'nha-trang', destinationName: 'Nha Trang', farePlans: fares };

async function setup() {
  const store = new MemoryCommerceStore();
  store.flights.push(
    { ...base, id: 'F2--Y', flightKey: 'F2', name: 'Bay SGN – CXR chiều', fromAirport: 'SGN', toAirport: 'CXR', departTime: '15:00', cabinName: 'Phổ thông', defaultSeats: 5, defaultPrice: 1_000_000 },
    { ...base, id: 'F1--Y', flightKey: 'F1', name: 'Bay SGN – CXR sớm', fromAirport: 'SGN', toAirport: 'CXR', departTime: '06:00', cabinName: 'Phổ thông', defaultSeats: 2, defaultPrice: 900_000 },
    { ...base, id: 'F1--C', flightKey: 'F1', name: 'Bay SGN – CXR sớm', fromAirport: 'SGN', toAirport: 'CXR', departTime: '06:00', cabinName: 'Thương gia', defaultSeats: 2, defaultPrice: 3_000_000 },
    { ...base, id: 'F3--Y', flightKey: 'F3', name: 'Bay HAN – CXR', fromAirport: 'HAN', toAirport: 'CXR', departTime: '08:00', cabinName: 'Phổ thông', defaultSeats: 5, defaultPrice: 1_500_000 },
  );
  const today = () => TODAY;
  await new CalendarUseCases(store, today).openCalendarWindow(30);
  // Bỏ ngẫu nhiên khỏi test: mọi ngày mở bán, giá đúng giá mặc định.
  for (const [key, d] of store.flightDays) {
    const flight = store.flights.find((f) => key.startsWith(`${f.id}|`))!;
    store.flightDays.set(key, { ...d, isStopSell: false, total: flight.defaultSeats, price: flight.defaultPrice });
  }
  return { store, flights: new FlightSearchUseCases(store, today) };
}

describe('FlightSearchUseCases.searchFlights', () => {
  it('chỉ trả chuyến đúng tuyến, mọi hạng ghế, giá theo từng gói và số khách', async () => {
    const { flights } = await setup();
    const result = await flights.searchFlights({ from: 'sgn', to: 'cxr', date: DATE, passengers: 2 });
    expect(result.query).toEqual({ from: 'SGN', to: 'CXR', date: DATE, passengers: 2 });
    expect(result.flights.map((f) => f.productId)).toEqual(['F1--Y', 'F1--C', 'F2--Y']);
    const economy = result.flights[0]!;
    expect(economy).toMatchObject({ isAvailable: true, reason: null, remaining: 2, priceFrom: 900_000, destination: { slug: 'nha-trang', name: 'Nha Trang' } });
    expect(economy.fares[0]).toMatchObject({ code: 'ECO', pricePerPerson: 900_000, totalPrice: 1_800_000 });
    expect(economy.fares[1]!.pricePerPerson).toBeGreaterThan(900_000);
  });

  it('hết ghế cho số khách đang tìm thì SOLD_OUT, không có giá, xếp sau chuyến còn ghế', async () => {
    const { flights } = await setup();
    const result = await flights.searchFlights({ from: 'SGN', to: 'CXR', date: DATE, passengers: 3 });
    expect(result.flights.map((f) => f.productId)).toEqual(['F2--Y', 'F1--Y', 'F1--C']);
    expect(result.flights[1]).toMatchObject({ isAvailable: false, reason: 'SOLD_OUT', remaining: 2, priceFrom: null });
    expect(result.flights[1]!.fares.every((f) => f.pricePerPerson === null && f.totalPrice === null)).toBe(true);
  });

  it('ngày dừng bán thì STOP_SELL; ngày chưa mở bán thì NOT_ON_SALE', async () => {
    const { store, flights } = await setup();
    store.flightDays.set(`F2--Y|${DATE}`, { ...store.flightDays.get(`F2--Y|${DATE}`)!, isStopSell: true });
    expect((await flights.searchFlights({ from: 'SGN', to: 'CXR', date: DATE })).flights.find((f) => f.productId === 'F2--Y')).toMatchObject({ isAvailable: false, reason: 'STOP_SELL' });
    const far = await flights.searchFlights({ from: 'SGN', to: 'CXR', date: '2027-06-01' });
    expect(far.flights.every((f) => f.reason === 'NOT_ON_SALE')).toBe(true);
  });

  it('tuyến không có chuyến thì danh sách rỗng', async () => {
    const { flights } = await setup();
    expect((await flights.searchFlights({ from: 'DAD', to: 'CXR', date: DATE })).flights).toEqual([]);
  });

  it('tham số sai thì báo lỗi invalid_query', async () => {
    const { flights } = await setup();
    const bad = [
      { from: 'SG', to: 'CXR', date: DATE },
      { from: 'SGN', to: 'SGN', date: DATE },
      { from: 'SGN', to: 'CXR', date: '2026-11-30' },
      { from: 'SGN', to: 'CXR', date: DATE, passengers: 0 },
      { from: 'SGN', to: 'CXR', date: DATE, passengers: 10 },
    ];
    for (const query of bad) await expect(flights.searchFlights(query)).rejects.toMatchObject({ code: 'invalid_query' });
  });
});

describe('FlightSearchUseCases.getFlightOffer', () => {
  it('trả đúng một hạng ghế theo productId; không có thì not_found', async () => {
    const { flights } = await setup();
    expect(await flights.getFlightOffer('F1--C', { date: DATE, passengers: 1 })).toMatchObject({ productId: 'F1--C', cabinName: 'Thương gia', priceFrom: 3_000_000 });
    await expect(flights.getFlightOffer('KHONG-CO', { date: DATE })).rejects.toBeInstanceOf(CommerceError);
  });
});

describe('FlightSearchUseCases.listRoutes', () => {
  it('gom theo tuyến, đếm chuyến không trùng hạng ghế', async () => {
    const { flights } = await setup();
    expect(await flights.listRoutes()).toEqual([
      { fromAirport: 'HAN', toAirport: 'CXR', destinationSlug: 'nha-trang', destinationName: 'Nha Trang', flightCount: 1 },
      { fromAirport: 'SGN', toAirport: 'CXR', destinationSlug: 'nha-trang', destinationName: 'Nha Trang', flightCount: 2 },
    ]);
  });
});
