import { describe, expect, it } from 'vitest';
import { COMPLETENESS_WEIGHTS, calculateCompleteness, hasPlan, planFullness, tripInfoFullness, type CompletenessInput } from './completeness.js';

const emptyPost = (): CompletenessInput => ({
  mediaIds: [],
  coverMediaId: null,
  body: '',
  hashtags: [],
  tripAttachment: null,
});
const withTrip = (tripAttachment: CompletenessInput['tripAttachment']): CompletenessInput => ({ ...emptyPost(), tripAttachment });
/** Chuyến n ngày, mỗi ngày một mục có nơi. */
const fullTrip = (n: number) => withTrip({ daysCount: n, items: Array.from({ length: n }, (_, i) => ({ day: i + 1, location: `Nơi ${i + 1}` })) });

describe('hasPlan', () => {
  it('cần ít nhất một mục lịch trình; chỉ ghi số ngày là lịch trình rỗng', () => {
    expect(hasPlan(emptyPost())).toBe(false);
    expect(hasPlan(withTrip({ destinationName: 'Đà Lạt' }))).toBe(false);
    expect(hasPlan(withTrip({ daysCount: 3 }))).toBe(false);
    expect(hasPlan(withTrip({ items: [], daysCount: 3 }))).toBe(false);
    expect(hasPlan(withTrip({ items: [{ day: 1 }] }))).toBe(true);
  });
});

describe('planFullness', () => {
  it('không có mục nào: 0, kể cả có daysCount', () => {
    expect(planFullness(withTrip({ daysCount: 3 }))).toBe(0);
  });

  it('đủ mọi ngày, mục nào cũng có nơi: 1', () => {
    expect(planFullness(fullTrip(3))).toBe(1);
  });

  it('không ưu tiên chuyến dài: 2 ngày đầy đủ bằng 5 ngày đầy đủ', () => {
    expect(planFullness(fullTrip(2))).toBe(planFullness(fullTrip(5)));
  });

  it('độ phủ ngày: 3 ngày chỉ có mục ngày 1 và 3 → 2/3', () => {
    const p = withTrip({ daysCount: 3, items: [{ day: 1, location: 'A' }, { day: 1, location: 'B' }, { day: 3, location: 'C' }] });
    expect(planFullness(p)).toBeCloseTo(0.6 * (2 / 3) + 0.4, 4);
  });

  it('tỉ lệ mục có nơi: location, khách sạn hoặc chặng đi lại đều tính là có nơi', () => {
    const p = withTrip({
      daysCount: 2,
      items: [{ day: 1, location: 'Chợ Đà Lạt' }, { day: 1, hotel: { hotelId: 'H1' } }, { day: 2, transport: { mode: 'flight' } }, { day: 2, location: '  ' }],
    });
    expect(planFullness(p)).toBeCloseTo(0.6 * 1 + 0.4 * (3 / 4), 4);
  });

  it('thiếu daysCount: lấy ngày lớn nhất trong mục; ngày vượt daysCount không tính', () => {
    expect(planFullness(withTrip({ items: [{ day: 1, location: 'A' }, { day: 4, location: 'B' }] }))).toBeCloseTo(0.6 * (2 / 4) + 0.4, 4);
    expect(planFullness(withTrip({ daysCount: 2, items: [{ day: 1, location: 'A' }, { day: 5, location: 'B' }] }))).toBeCloseTo(0.6 * (1 / 2) + 0.4, 4);
  });

  it('mục không có ngày, không có nơi: chỉ còn rất ít điểm', () => {
    expect(planFullness(withTrip({ items: [{ title: 'Ăn sáng' }] }))).toBe(0);
  });
});

describe('tripInfoFullness', () => {
  it('điểm đến, số ngày, chi phí mỗi thứ một phần ba', () => {
    expect(tripInfoFullness(withTrip({ destinationName: 'Huế' }))).toBeCloseTo(1 / 3, 4);
    expect(tripInfoFullness(withTrip({ destinationPlaceId: 'hue', daysCount: 2 }))).toBeCloseTo(2 / 3, 4);
    expect(tripInfoFullness(withTrip({ destinationName: 'Huế', daysCount: 2, estimatedCostPerPerson: 1_500_000 }))).toBe(1);
  });
});

describe('calculateCompleteness', () => {
  it('bài trống cho 0, bài đủ mọi thành phần cho 1', () => {
    expect(calculateCompleteness(emptyPost())).toBe(0);
    const full: CompletenessInput = {
      ...fullTrip(3),
      mediaIds: ['m1'],
      coverMediaId: 'c1',
      body: 'Chuyến đi Đà Lạt 3 ngày 2 đêm rất tuyệt vời và đáng nhớ!',
      hashtags: ['dalat'],
      tripAttachment: { ...fullTrip(3).tripAttachment, destinationName: 'Đà Lạt', estimatedCostPerPerson: 3_000_000 },
    };
    expect(calculateCompleteness(full)).toBe(1);
  });

  it('media, caption, hashtag cộng đúng trọng số', () => {
    expect(calculateCompleteness({ ...emptyPost(), mediaIds: ['m1'] })).toBe(COMPLETENESS_WEIGHTS.media);
    expect(calculateCompleteness({ ...emptyPost(), coverMediaId: 'c1' })).toBe(COMPLETENESS_WEIGHTS.media);
    expect(calculateCompleteness({ ...emptyPost(), body: '   quá ngắn   ' })).toBe(0);
    expect(calculateCompleteness({ ...emptyPost(), body: 'a'.repeat(30) })).toBe(COMPLETENESS_WEIGHTS.caption);
    expect(calculateCompleteness({ ...emptyPost(), hashtags: ['travel'] })).toBe(COMPLETENESS_WEIGHTS.hashtag);
  });

  it('lịch trình chỉ ghi "3 ngày" thấp hơn hẳn lịch trình 3 ngày đầy đủ', () => {
    // Rỗng: chỉ được phần số ngày của thông tin chuyến (0,15 / 3 = 0,05).
    expect(calculateCompleteness(withTrip({ daysCount: 3 }))).toBe(0.05);
    // Đầy đủ ngày + nơi, có số ngày: 0,3 + 0,05.
    expect(calculateCompleteness(fullTrip(3))).toBe(0.35);
  });
});
