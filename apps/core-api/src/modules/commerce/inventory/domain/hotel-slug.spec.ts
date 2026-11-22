import { readFileSync } from 'node:fs';
import { buildHotelSlug } from './hotel-slug.js';

describe('buildHotelSlug', () => {
  it('bỏ dấu tiếng Việt, chỉ còn chữ thường, số và gạch nối, thêm 4 ký tự', () => {
    expect(buildHotelSlug('P-h-dn-01', 'Đà Nẵng – Khách sạn Biển Xanh!')).toMatch(/^da-nang-khach-san-bien-xanh-[a-z0-9]{4}$/);
  });

  it('cùng đầu vào luôn ra cùng slug', () => {
    expect(buildHotelSlug('P-h-dn-01', 'Biển Xanh')).toBe(buildHotelSlug('P-h-dn-01', 'Biển Xanh'));
  });

  it('cùng tên khác id thì khác slug', () => {
    expect(buildHotelSlug('P-h-dn-01', 'Biển Xanh')).not.toBe(buildHotelSlug('P-h-dn-02', 'Biển Xanh'));
  });

  it('toàn bộ khách sạn trong seed có slug hợp lệ và không trùng', () => {
    const { hotels } = JSON.parse(readFileSync(new URL('../../db/seed/catalog.json', import.meta.url), 'utf8')) as { hotels: { id: string; name: string }[] };
    const slugs = hotels.map((hotel) => buildHotelSlug(hotel.id, hotel.name));
    expect(new Set(slugs).size).toBe(hotels.length);
    for (const slug of slugs) expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });
});
