import { calculatePlanPrice, countRoomsNeeded, quoteFlight, quoteStay, type PricePlan, type RoomDay } from './sales-rules.js';

const plan: PricePlan = { code: 'RO', name: 'Chỉ phòng', meal: 'none', refundable: true, freeCancelDays: 3, priceFactor: 1 };
const day = (date: string, patch: Partial<RoomDay> = {}): RoomDay => ({
  date,
  total: 5,
  held: 0,
  sold: 0,
  price: 1_000_000,
  isStopSell: false,
  isClosedToArrival: false,
  isClosedToDeparture: false,
  minLos: 1,
  maxLos: 14,
  ...patch,
});
const stay = (days: RoomDay[], rooms = 1) => quoteStay({ days, checkIn: '2026-12-01', checkOut: '2026-12-03', rooms, plan });

describe('quoteStay', () => {
  it('đủ phòng mọi đêm: tổng tiền = giá từng đêm × số phòng, còn lại = đêm ít phòng nhất', () => {
    const quote = stay([day('2026-12-01'), day('2026-12-02', { sold: 3, price: 1_200_000 }), day('2026-12-03')], 2);
    expect(quote).toMatchObject({ isAvailable: true, nights: 2, remaining: 2, totalPrice: 4_400_000, pricePerNight: 1_100_000 });
  });

  it('một đêm không đủ phòng thì hết chỗ, kể cả đêm khác còn nhiều', () => {
    expect(stay([day('2026-12-01'), day('2026-12-02', { held: 2, sold: 3 })])).toMatchObject({ isAvailable: false, reason: 'SOLD_OUT', remaining: 0 });
  });

  it('luật bán: ngừng bán, CTA ngày nhận, CTD ngày trả, số đêm tối thiểu', () => {
    expect(stay([day('2026-12-01'), day('2026-12-02', { isStopSell: true })])).toMatchObject({ reason: 'STOP_SELL' });
    expect(stay([day('2026-12-01', { isClosedToArrival: true }), day('2026-12-02')])).toMatchObject({ reason: 'CTA' });
    expect(stay([day('2026-12-01'), day('2026-12-02'), day('2026-12-03', { isClosedToDeparture: true })])).toMatchObject({ reason: 'CTD' });
    expect(stay([day('2026-12-01', { minLos: 3 }), day('2026-12-02')])).toMatchObject({ reason: 'MIN_LOS', minLos: 3 });
  });

  it('thiếu ngày trong lịch (chưa mở bán) thì không bán', () => {
    expect(stay([day('2026-12-01')])).toMatchObject({ isAvailable: false, reason: 'NOT_ON_SALE' });
  });
});

describe('quoteFlight và giá', () => {
  it('đủ ghế cho cả nhóm; thiếu thì hết chỗ', () => {
    const flightDay = { date: '2026-12-01', total: 10, held: 2, sold: 6, price: 1_500_000, isStopSell: false };
    expect(quoteFlight({ day: flightDay, passengers: 2, plan })).toMatchObject({ isAvailable: true, totalPrice: 3_000_000 });
    expect(quoteFlight({ day: flightDay, passengers: 3, plan })).toMatchObject({ isAvailable: false, reason: 'SOLD_OUT', remaining: 2 });
  });

  it('giá theo gói làm tròn tới 10.000đ; số phòng tối thiểu cho nhóm', () => {
    expect(calculatePlanPrice(1_234_567, { ...plan, priceFactor: 1.15 })).toBe(1_420_000);
    expect(countRoomsNeeded(5, 2)).toBe(3);
  });
});
