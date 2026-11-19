import { PLACES } from '../../search/domain/places.js';
import { placeIdOfPost } from './place-of-post.js';

const hotels = new Map([['H1', 'khanh-hoa']]);

describe('placeIdOfPost', () => {
  it('ưu tiên tỉnh của khách sạn gắn bài', () => {
    expect(placeIdOfPost({ hotelId: 'H1', destinationName: 'Đà Lạt', title: '' }, hotels)).toBe('khanh-hoa');
  });

  it('không có khách sạn: tên nơi trong destinationName + title, đổi về id PLACES', () => {
    expect(placeIdOfPost({ hotelId: null, destinationName: 'Đà Lạt', title: 'Săn mây' }, hotels)).toBe('da-lat');
    expect(placeIdOfPost({ hotelId: 'H-lạ', destinationName: null, title: '3 ngày ở Sài Gòn' }, hotels)).toBe('sai-gon');
    expect(placeIdOfPost({ hotelId: null, destinationName: null, title: 'review dalat' }, hotels)).toBe('da-lat');
  });

  it('không nhận ra nơi → null; điểm đến của lexicon (Sa Pa, Hà Giang, Cô Tô) có id', () => {
    expect(placeIdOfPost({ hotelId: null, destinationName: null, title: 'Ăn gì hôm nay' }, hotels)).toBeNull();
    expect(placeIdOfPost({ hotelId: null, destinationName: 'Sa Pa', title: '' }, hotels)).toBe('sa-pa');
    expect(placeIdOfPost({ hotelId: null, destinationName: 'Hà Giang', title: '' }, hotels)).toBe('ha-giang');
    expect(placeIdOfPost({ hotelId: null, destinationName: null, title: 'Ngày 2 ở Cô Tô' }, hotels)).toBe('co-to');
  });

  it('mọi id trả ra đều có trong PLACES', () => {
    const ids = new Set(PLACES.map((p) => p.id));
    for (const name of ['Hà Nội', 'Huế', 'Đà Nẵng', 'Hội An', 'Nha Trang', 'Phú Quốc', 'Hạ Long', 'Quy Nhơn', 'Côn Đảo', 'Ninh Bình', 'Sài Gòn']) {
      const id = placeIdOfPost({ hotelId: null, destinationName: name, title: '' }, hotels);
      expect(id && ids.has(id)).toBe(true);
    }
  });
});
