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

describe('FlightSearchUseCases: thông tin hiển thị và sắp xếp', () => {
  it('trả mã hãng, số hiệu, hạng ghế, thời gian bay (qua nửa đêm), điểm dừng, hành lý, cờ giá gồm thuế', async () => {
    const { store, flights } = await setup();
    Object.assign(store.flights.find((f) => f.id === 'F2--Y')!, {
      airlineCode: 'VJ',
      flightNumber: 'VJ141',
      cabinCode: 'Y',
      stops: 0,
      departTime: '23:30',
      arriveTime: '01:40',
      farePlans: fares.map((f) => ({ ...f, carryOnKg: 7, checkedKg: f.code === 'FLEX' ? 20 : 0 })),
    });
    const offer = await flights.getFlightOffer('F2--Y', { date: DATE });
    expect(offer).toMatchObject({ airlineCode: 'VJ', flightNumber: 'VJ141', cabinCode: 'Y', stops: 0, durationMinutes: 130, isPriceTaxIncluded: true });
    expect(offer.fares.map((f) => [f.code, f.carryOnKg, f.checkedKg])).toEqual([['ECO', 7, 0], ['FLEX', 7, 20]]);
    // Dữ liệu cũ chưa có các trường mới: trả null, không lỗi.
    expect(await flights.getFlightOffer('F1--Y', { date: DATE })).toMatchObject({ airlineCode: null, flightNumber: null, durationMinutes: null, stops: 0, fares: [{ carryOnKg: null, checkedKg: null }, {}] });
  });

  it('sort=price, duration, departure; chuyến hết ghế luôn ở cuối; sort sai thì báo lỗi', async () => {
    const { store, flights } = await setup();
    store.flights.find((f) => f.id === 'F2--Y')!.arriveTime = '16:00';
    store.flights.find((f) => f.id === 'F1--Y')!.arriveTime = '07:30';
    store.flights.find((f) => f.id === 'F1--C')!.arriveTime = '07:30';
    const ids = async (sort: 'price' | 'duration' | 'departure', passengers = 1) =>
      (await flights.searchFlights({ from: 'SGN', to: 'CXR', date: DATE, passengers, sort })).flights.map((f) => f.productId);
    expect(await ids('price')).toEqual(['F1--Y', 'F2--Y', 'F1--C']);
    expect(await ids('duration')).toEqual(['F2--Y', 'F1--Y', 'F1--C']);
    expect(await ids('departure')).toEqual(['F1--Y', 'F1--C', 'F2--Y']);
    expect(await ids('price', 3)).toEqual(['F2--Y', 'F1--Y', 'F1--C']);
    await expect(flights.searchFlights({ from: 'SGN', to: 'CXR', date: DATE, sort: 'random' as never })).rejects.toMatchObject({ field: 'sort' });
  });
});

describe('FlightSearchUseCases.getPriceCalendar', () => {
  it('giá rẻ nhất từng ngày trên tuyến, tính cả số khách; ngày hết ghế hoặc chưa mở bán thì null', async () => {
    const { store, flights } = await setup();
    store.flightDays.set('F1--Y|2026-12-02', { ...store.flightDays.get('F1--Y|2026-12-02')!, price: 800_000 });
    store.flightDays.set('F2--Y|2026-12-03', { ...store.flightDays.get('F2--Y|2026-12-03')!, isStopSell: true });
    const result = await flights.getPriceCalendar({ from: 'sgn', to: 'cxr', start: '2026-12-02', end: '2026-12-04' });
    expect(result.query).toEqual({ from: 'SGN', to: 'CXR', start: '2026-12-02', end: '2026-12-04', passengers: 1 });
    expect(result.days).toEqual([
      { date: '2026-12-02', priceFrom: 800_000, isAvailable: true },
      { date: '2026-12-03', priceFrom: 900_000, isAvailable: true },
      { date: '2026-12-04', priceFrom: 900_000, isAvailable: true },
    ]);
    // 3 khách: F1 chỉ có 2 ghế mỗi hạng, nên chỉ còn F2; ngày F2 dừng bán thì không có chuyến nào.
    const group = await flights.getPriceCalendar({ from: 'SGN', to: 'CXR', start: '2026-12-02', end: '2026-12-03', passengers: 3 });
    expect(group.days).toEqual([
      { date: '2026-12-02', priceFrom: 1_000_000, isAvailable: true },
      { date: '2026-12-03', priceFrom: null, isAvailable: false },
    ]);
    const far = await flights.getPriceCalendar({ from: 'SGN', to: 'CXR', start: '2027-06-01', end: '2027-06-01' });
    expect(far.days).toEqual([{ date: '2027-06-01', priceFrom: null, isAvailable: false }]);
  });

  it('khoảng ngày sai, quá 31 ngày, ngày quá khứ thì báo lỗi đúng trường', async () => {
    const { flights } = await setup();
    await expect(flights.getPriceCalendar({ from: 'SGN', to: 'CXR', start: '2026-11-30', end: '2026-12-02' })).rejects.toMatchObject({ field: 'start' });
    await expect(flights.getPriceCalendar({ from: 'SGN', to: 'CXR', start: '2026-12-05', end: '2026-12-04' })).rejects.toMatchObject({ field: 'end' });
    await expect(flights.getPriceCalendar({ from: 'SGN', to: 'CXR', start: '2026-12-01', end: '2027-01-01' })).rejects.toMatchObject({ field: 'end' });
    await expect(flights.getPriceCalendar({ from: 'SGN', to: 'SGN', start: '2026-12-01', end: '2026-12-02' })).rejects.toMatchObject({ field: 'to' });
  });
});
