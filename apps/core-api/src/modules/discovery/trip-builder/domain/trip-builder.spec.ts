import { formatVnd, rankFlights, rankStays, type FlightCandidate, type StayCandidate } from './trip-builder.js';

const flight = (id: string, departTime: string, arriveTime: string, unitPrice: number): FlightCandidate => ({
  flightId: id,
  productId: `${id}-ECO`,
  ratePlanCode: 'ECO',
  name: id,
  airline: 'Vietjet Air',
  fromAirport: 'SGN',
  toAirport: 'CXR',
  departTime,
  arriveTime,
  unitPrice,
  totalPrice: unitPrice * 2,
});

const stay = (id: string, unitPrice: number, rating: StayCandidate['rating']): StayCandidate => ({
  hotelId: id,
  slug: id,
  name: id,
  stars: 3,
  thumbnail: null,
  rating,
  roomProductId: `${id}--DLX`,
  ratePlanCode: 'RO',
  unitPrice,
  totalPrice: unitPrice * 2,
});

describe('rankFlights (TF105 tự lên lộ trình)', () => {
  const early = flight('VJ135', '06:45', '08:20', 950_000);
  const evening = flight('VN201', '17:00', '18:35', 1_000_000);
  const noon = flight('BL327', '11:30', '13:05', 1_270_000);
  const dawn = flight('VJ001', '05:00', '06:35', 900_000);

  it('rẻ nhất: xếp theo tổng giá, chuyến rẻ nhất ghi giá mỗi người', () => {
    const ranked = rankFlights([noon, evening, early], 'outbound', 'cheapest');
    expect(ranked.map((f) => f.flightId)).toEqual(['VJ135', 'VN201', 'BL327']);
    expect(ranked[0]!.reason).toEqual({ code: 'cheapest', text: `Rẻ nhất · ${formatVnd(950_000)}/người` });
    expect(ranked[2]!.reason).toEqual({ code: 'arrive_before_check_in', text: 'Tới 13:05, kịp nhận phòng' });
  });

  it('giờ đẹp chiều đi: tới trước giờ nhận phòng và không quá sớm lên trước', () => {
    const ranked = rankFlights([evening, dawn, noon, early], 'outbound', 'best_time');
    expect(ranked.map((f) => f.flightId)).toEqual(['VJ135', 'BL327', 'VJ001', 'VN201']);
    expect(ranked[0]!.reason?.text).toBe('Tới 08:20, kịp nhận phòng');
    expect(ranked[2]!.reason).toBeNull();
  });

  it('giờ đẹp chiều về: bay từ trưa trở đi còn trọn buổi sáng cuối', () => {
    const back = [flight('VN200', '07:00', '08:35', 900_000), flight('VN202', '16:30', '18:05', 920_000)];
    const ranked = rankFlights(back, 'inbound', 'best_time');
    expect(ranked.map((f) => [f.flightId, f.reason?.text])).toEqual([
      ['VN202', 'Bay 16:30, trọn buổi sáng cuối'],
      ['VN200', undefined],
    ]);
  });
});

describe('rankStays (TF105 tự lên lộ trình)', () => {
  const cheap = stay('mong-an', 330_000, { average: 4.4, count: 12 });
  const top = stay('vinpearl', 3_320_000, { average: 4.9, count: 252 });
  const topFewer = stay('paragon', 6_830_000, { average: 4.9, count: 135 });
  const unrated = stay('moi', 300_000, null);

  it('giá tốt: rẻ một đêm trước, lý do là giá một đêm', () => {
    const ranked = rankStays([top, cheap, unrated], 'best_price');
    expect(ranked.map((s) => s.hotelId)).toEqual(['moi', 'mong-an', 'vinpearl']);
    expect(ranked[1]!.reason).toEqual({ code: 'best_price', text: `${formatVnd(330_000)}/đêm` });
  });

  it('đánh giá cao: điểm cao trước, bằng điểm thì nhiều đánh giá hơn, chưa có đánh giá xuống cuối', () => {
    const ranked = rankStays([unrated, topFewer, cheap, top], 'top_rated');
    expect(ranked.map((s) => s.hotelId)).toEqual(['vinpearl', 'paragon', 'mong-an', 'moi']);
    expect(ranked[0]!.reason).toEqual({ code: 'top_rated', text: '4,9/5 · 252 đánh giá' });
    expect(ranked[3]!.reason).toBeNull();
  });
});
