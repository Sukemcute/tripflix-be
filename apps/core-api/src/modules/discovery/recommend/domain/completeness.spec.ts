import { describe, expect, it } from 'vitest';
import { COMPLETENESS_WEIGHTS, calculateCompleteness, hasPlan, type CompletenessInput } from './completeness.js';

const emptyPost = (): CompletenessInput => ({
  mediaIds: [],
  coverMediaId: null,
  body: '',
  hashtags: [],
  tripAttachment: null,
});

describe('hasPlan', () => {
  it('trả false khi không có tripAttachment hoặc rỗng', () => {
    expect(hasPlan(emptyPost())).toBe(false);
    expect(hasPlan({ ...emptyPost(), tripAttachment: { destinationName: 'Đà Lạt' } })).toBe(false);
    expect(hasPlan({ ...emptyPost(), tripAttachment: { items: [], daysCount: 0 } })).toBe(false);
  });

  it('trả true khi items không rỗng hoặc daysCount > 0', () => {
    expect(hasPlan({ ...emptyPost(), tripAttachment: { items: [{ day: 1 }] } })).toBe(true);
    expect(hasPlan({ ...emptyPost(), tripAttachment: { daysCount: 3 } })).toBe(true);
  });
});

describe('calculateCompleteness', () => {
  it('bài trống cho 0, bài đủ mọi thành phần cho 1', () => {
    expect(calculateCompleteness(emptyPost())).toBe(0);

    const full: CompletenessInput = {
      mediaIds: ['m1'],
      coverMediaId: 'c1',
      body: 'Chuyến đi Đà Lạt 3 ngày 2 đêm rất tuyệt vời và đáng nhớ!',
      hashtags: ['dalat'],
      tripAttachment: {
        items: [{ day: 1 }],
        daysCount: 3,
        destinationName: 'Đà Lạt',
        destinationPlaceId: 'da-lat',
        estimatedCostPerPerson: 3_000_000,
      },
    };
    expect(calculateCompleteness(full)).toBe(1);
  });

  it('cộng đúng từng thành phần theo COMPLETENESS_WEIGHTS', () => {
    expect(calculateCompleteness({ ...emptyPost(), mediaIds: ['m1'] })).toBe(COMPLETENESS_WEIGHTS.media);
    expect(calculateCompleteness({ ...emptyPost(), coverMediaId: 'c1' })).toBe(COMPLETENESS_WEIGHTS.media);

    expect(calculateCompleteness({ ...emptyPost(), body: '   quá ngắn   ' })).toBe(0);
    expect(calculateCompleteness({ ...emptyPost(), body: 'a'.repeat(30) })).toBe(COMPLETENESS_WEIGHTS.caption);

    expect(calculateCompleteness({ ...emptyPost(), hashtags: ['travel'] })).toBe(COMPLETENESS_WEIGHTS.hashtag);

    // items không rỗng đạt cả lịch trình lẫn không đạt thông tin chuyến nếu thiếu các trường info
    expect(calculateCompleteness({ ...emptyPost(), tripAttachment: { items: [{ title: 'Ngày 1' }] } })).toBe(
      COMPLETENESS_WEIGHTS.plan,
    );

    // daysCount > 0 đạt cả lịch trình (0.3) lẫn thông tin chuyến (0.15)
    expect(calculateCompleteness({ ...emptyPost(), tripAttachment: { daysCount: 2 } })).toBe(0.45);

    // chỉ có destinationName đạt thông tin chuyến (0.15)
    expect(calculateCompleteness({ ...emptyPost(), tripAttachment: { destinationName: 'Huế' } })).toBe(
      COMPLETENESS_WEIGHTS.tripInfo,
    );
    expect(calculateCompleteness({ ...emptyPost(), tripAttachment: { destinationPlaceId: 'hue' } })).toBe(
      COMPLETENESS_WEIGHTS.tripInfo,
    );
    expect(calculateCompleteness({ ...emptyPost(), tripAttachment: { estimatedCostPerPerson: 1_500_000 } })).toBe(
      COMPLETENESS_WEIGHTS.tripInfo,
    );
  });
});
