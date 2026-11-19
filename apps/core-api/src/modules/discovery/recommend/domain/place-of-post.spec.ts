import { PLACES } from '../../search/domain/places.js';
import { placeIdOfPost } from './place-of-post.js';

const hotels = new Map([['H1', 'khanh-hoa']]);

describe('placeIdOfPost', () => {
  it('ưu tiên tỉnh của khách sạn gắn bài, rồi placeId → tag → destinationName → title → body → trip.items', () => {
    expect(placeIdOfPost({ hotelId: 'H1', placeId: 'hue', tags: ['sapa'], destinationName: 'Đà Lạt', title: 'Hà Nội', body: 'Huế' }, hotels)).toBe('khanh-hoa');
    expect(placeIdOfPost({ hotelId: null, placeId: 'hue', tags: ['sapa'], destinationName: 'Đà Lạt', title: 'Hà Nội' }, hotels)).toBe('hue');
    expect(placeIdOfPost({ hotelId: null, tags: ['HaGiang'], destinationName: 'Đà Lạt', title: 'Hà Nội' }, hotels)).toBe('ha-giang');
    expect(placeIdOfPost({ hotelId: null, tags: ['fyp'], destinationName: 'Đà Lạt', title: 'Hà Nội' }, hotels)).toBe('da-lat');
    expect(placeIdOfPost({ hotelId: null, tags: [], destinationName: null, title: '3 ngày ở Sài Gòn', body: 'Huế' }, hotels)).toBe('sai-gon');
    expect(placeIdOfPost({ hotelId: null, tags: [], destinationName: null, title: 'Đi đâu cuối tuần', body: 'Khám phá Cát Bà' }, hotels)).toBe('cat-ba');
    expect(placeIdOfPost({ hotelId: null, tags: [], destinationName: null, title: 'Lịch trình', body: '', items: [{ location: 'Mũi Né' }] }, hotels)).toBe('mui-ne');
  });

  it('không có khách sạn: tên nơi trong destinationName + title + tag + bí danh', () => {
    expect(placeIdOfPost({ hotelId: null, destinationName: 'Đà Lạt', title: 'Săn mây' }, hotels)).toBe('da-lat');
    expect(placeIdOfPost({ hotelId: 'H-lạ', destinationName: null, title: '3 ngày ở Sài Gòn' }, hotels)).toBe('sai-gon');
    expect(placeIdOfPost({ hotelId: null, destinationName: null, title: 'review dalat' }, hotels)).toBe('da-lat');
    expect(placeIdOfPost({ hotelId: null, tags: ['nghean', 'cualo'], title: '' }, hotels)).toBe('cua-lo');
  });

  it('không nhận ra nơi → null; điểm đến của PLACES có id', () => {
    expect(placeIdOfPost({ hotelId: null, destinationName: null, title: 'Ăn gì hôm nay' }, hotels)).toBeNull();
    expect(placeIdOfPost({ hotelId: null, destinationName: 'Sa Pa', title: '' }, hotels)).toBe('sa-pa');
    expect(placeIdOfPost({ hotelId: null, destinationName: 'Hà Giang', title: '' }, hotels)).toBe('ha-giang');
    expect(placeIdOfPost({ hotelId: null, destinationName: null, title: 'Ngày 2 ở Cô Tô' }, hotels)).toBe('co-to');
  });

  it('mọi id trả ra đều có trong PLACES', () => {
    const ids = new Set(PLACES.map((p) => p.id));
    for (const name of ['Hà Nội', 'Huế', 'Đà Nẵng', 'Hội An', 'Nha Trang', 'Phú Quốc', 'Hạ Long', 'Quy Nhơn', 'Côn Đảo', 'Ninh Bình', 'Sài Gòn', 'Cần Thơ', 'Mũi Né', 'Cát Bà']) {
      const id = placeIdOfPost({ hotelId: null, destinationName: name, title: '' }, hotels);
      expect(id && ids.has(id)).toBe(true);
    }
  });
});
