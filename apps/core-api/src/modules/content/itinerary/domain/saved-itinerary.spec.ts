import { describe, expect, it } from 'vitest';
import { EmptyItineraryError, fromBuilder, fromReel, fromTripi } from './saved-itinerary.js';

describe('fromReel', () => {
  it('chép điểm của reel, giữ link reel gốc', () => {
    const draft = fromReel({
      id: 'post-1',
      title: 'Đà Nẵng 3 ngày',
      tripAttachment: { destinationName: 'Đà Nẵng', daysCount: 3, items: [{ day: 1, title: 'Cà phê', category: 'cafe', time: '08:00' }] },
    });
    expect(draft).toMatchObject({ source: 'reel', sourcePostId: 'post-1', title: 'Đà Nẵng 3 ngày', daysCount: 3, destinationName: 'Đà Nẵng' });
    expect(draft.items).toEqual([{ day: 1, title: 'Cà phê', category: 'cafe', time: '08:00' }]);
  });

  it('reel không gắn lộ trình thì báo lỗi', () => {
    expect(() => fromReel({ id: 'p', title: 'x', tripAttachment: null })).toThrow(EmptyItineraryError);
  });
});

describe('fromTripi', () => {
  it('ngày theo thứ tự, sắp theo buổi; chỗ ở và chặng đi ở Ngày 1, chặng về ở ngày cuối; bỏ ngày thật', () => {
    const draft = fromTripi({
      place: 'Đà Nẵng',
      stay: { source: 'tripflix', id: 'H1', name: 'Vinpearl' },
      transport: { mode: 'flight', summary: 'VN123', fromAirport: 'SGN', toAirport: 'DAD' },
      returnTransport: { mode: 'flight', summary: 'VN124', fromAirport: 'DAD', toAirport: 'SGN' },
      days: [
        [
          { id: 'p2', name: 'Chợ đêm', lat: 16.06, lng: 108.22, slot: 'tối' },
          { id: 'p1', name: 'Bà Nà', lat: 15.99, lng: 107.99, slot: 'sáng' },
        ],
        [{ id: 'p3', name: 'Mỹ Khê', slot: 'chiều' }],
      ],
    });
    expect(draft).toMatchObject({ source: 'tripi', sourcePostId: null, daysCount: 2, title: 'Đà Nẵng 2 ngày' });
    expect(draft.items.map((i) => [i.day, i.title])).toEqual([
      [1, 'Bay SGN → DAD'],
      [1, 'Vinpearl'],
      [1, 'Bà Nà'],
      [1, 'Chợ đêm'],
      [2, 'Mỹ Khê'],
      [2, 'Bay DAD → SGN'],
    ]);
    expect(draft.items[1]).toMatchObject({ hotel: { hotelId: 'H1' } });
    expect(draft.items[2]).toMatchObject({ slot: 'sáng', placeId: 'p1', lat: 15.99, lng: 107.99 });
    expect(JSON.stringify(draft)).not.toContain('VN123');
  });

  it('chỗ ở ngoài Tripflix không gắn hotelId', () => {
    const draft = fromTripi({ place: 'Huế', stay: { source: 'external', id: 'x', name: 'Homestay' }, days: [[{ id: 'a', name: 'Đại Nội' }]] });
    expect(draft.items[0]).not.toHaveProperty('hotel');
  });

  it('không có điểm nào thì báo lỗi', () => {
    expect(() => fromTripi({ place: 'Huế', days: [] })).toThrow(EmptyItineraryError);
  });
});

describe('fromBuilder', () => {
  it('đổi ngày thật thành Ngày 1..N, giữ khách sạn và loại phòng, bỏ giá', () => {
    const draft = fromBuilder({
      destinationName: 'Nha Trang',
      dayCount: 4,
      items: [
        { kind: 'activity', date: '2026-12-03', time: '19:00', title: 'Ăn hải sản', category: 'food', detail: 'Chợ Đầm' },
        { kind: 'hotel', checkIn: '2026-12-01', nights: 2, hotelId: 'H9', hotelName: 'Liberty', productId: 'R1', ratePlanCode: 'BB' },
        { kind: 'flight', date: '2026-12-01', from: 'HAN', to: 'CXR', departTime: '08:30:00' },
      ],
    });
    expect(draft).toMatchObject({ source: 'builder', daysCount: 4, title: 'Nha Trang 4 ngày' });
    expect(draft.items).toEqual([
      { day: 1, time: '08:30', title: 'Bay HAN → CXR', transport: { mode: 'flight', fromAirport: 'HAN', toAirport: 'CXR' } },
      { day: 1, time: '14:00', title: 'Liberty', nights: 2, hotel: { hotelId: 'H9', productId: 'R1', ratePlanCode: 'BB' } },
      { day: 3, time: '19:00', title: 'Ăn hải sản', category: 'food', location: 'Chợ Đầm' },
    ]);
  });
});
