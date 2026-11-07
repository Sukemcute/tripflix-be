import { calculatePassengerFares, calculatePlanPrice, countRoomsNeeded, findPassengerMixError, quoteFlight, quoteStay, type PricePlan, type RoomDay } from './sales-rules.js';

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

  it('trẻ em chiếm ghế và trả 75%, em bé không chiếm ghế và trả 10%', () => {
    const flightDay = { date: '2026-12-01', total: 10, held: 2, sold: 5, price: 1_500_000, isStopSell: false };
    // 2 người lớn × 1.500.000 + 1 trẻ em × 1.130.000 (1.125.000 làm tròn) + 1 em bé × 150.000.
    expect(quoteFlight({ day: flightDay, passengers: 2, children: 1, infants: 1, plan })).toMatchObject({ isAvailable: true, remaining: 3, totalPrice: 4_280_000, pricePerNight: 1_500_000 });
    // Còn 3 ghế: 2 người lớn + 2 trẻ em là 4 ghế thì hết chỗ, dù em bé không tính ghế.
    expect(quoteFlight({ day: flightDay, passengers: 2, children: 2, infants: 2, plan })).toMatchObject({ isAvailable: false, reason: 'SOLD_OUT', remaining: 3 });
    expect(calculatePassengerFares(1_500_000)).toEqual({ adult: 1_500_000, child: 1_130_000, infant: 150_000 });
  });

  it('nhóm khách: ít nhất 1 người lớn, tối đa 9 ghế, mỗi em bé cần một người lớn', () => {
    expect(findPassengerMixError({ adults: 2, children: 7, infants: 2 })).toBeNull();
    expect(findPassengerMixError({ adults: 0, children: 1, infants: 0 })).toMatchObject({ field: 'adults' });
    expect(findPassengerMixError({ adults: 3, children: 7, infants: 0 })).toMatchObject({ field: 'children' });
    expect(findPassengerMixError({ adults: 1, children: 0, infants: 2 })).toMatchObject({ field: 'infants' });
    expect(findPassengerMixError({ adults: 1, children: -1, infants: 0 })).toMatchObject({ field: 'children' });
  });

  it('giá theo gói làm tròn tới 10.000đ; số phòng tối thiểu cho nhóm', () => {
    expect(calculatePlanPrice(1_234_567, { ...plan, priceFactor: 1.15 })).toBe(1_420_000);
    expect(countRoomsNeeded(5, 2)).toBe(3);
  });
});
