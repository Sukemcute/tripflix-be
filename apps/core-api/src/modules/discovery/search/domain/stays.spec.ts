import { describe, expect, it } from 'vitest';
import { filterAndSortStays, paginate, resolvePlaceSlugs, type StayResult } from './stays.js';

const stay = (hotelId: string, unitPrice: number, stars: number | null): StayResult => ({
  hotelId,
  name: hotelId,
  stars,
  thumbnail: null,
  province: { slug: 'da-nang', name: 'Đà Nẵng' },
  unitPrice,
  totalPrice: unitPrice * 2,
});

describe('resolvePlaceSlugs', () => {
  it('tỉnh gồm cả điểm đến con', () => {
    expect(resolvePlaceSlugs('lam-dong')).toEqual(['lam-dong', 'da-lat']);
    expect(resolvePlaceSlugs('ho-chi-minh')).toEqual(expect.arrayContaining(['ho-chi-minh', 'sai-gon', 'con-dao']));
  });

  it('điểm đến chỉ là chính nó', () => {
    expect(resolvePlaceSlugs('da-lat')).toEqual(['da-lat']);
  });

  it('nơi lạ thì null', () => {
    expect(resolvePlaceSlugs('atlantis')).toBeNull();
  });
});

describe('filterAndSortStays', () => {
  const stays = [stay('a', 900_000, 3), stay('b', 500_000, 5), stay('c', 1_500_000, 4), stay('d', 700_000, null)];

  it('mặc định rẻ trước', () => {
    expect(filterAndSortStays(stays, {}, 'price').map((s) => s.hotelId)).toEqual(['b', 'd', 'a', 'c']);
  });

  it('theo sao: nhiều sao trước, cùng sao thì rẻ trước, chưa xếp hạng cuối', () => {
    expect(filterAndSortStays(stays, {}, 'stars').map((s) => s.hotelId)).toEqual(['b', 'c', 'a', 'd']);
  });

  it('lọc sao tối thiểu và khoảng giá một đêm', () => {
    const picked = filterAndSortStays(stays, { minStars: 4, priceMax: 1_000_000 }, 'price');
    expect(picked.map((s) => s.hotelId)).toEqual(['b']);
    expect(filterAndSortStays(stays, { priceMin: 800_000 }, 'price').map((s) => s.hotelId)).toEqual(['a', 'c']);
  });
});

describe('paginate', () => {
  it('cắt trang và trả con trỏ trang sau, hết thì null', () => {
    const first = paginate([1, 2, 3, 4, 5], undefined, 2);
    expect(first).toEqual({ items: [1, 2], nextCursor: '2' });
    expect(paginate([1, 2, 3, 4, 5], first.nextCursor!, 2)).toEqual({ items: [3, 4], nextCursor: '4' });
    expect(paginate([1, 2, 3, 4, 5], '4', 2)).toEqual({ items: [5], nextCursor: null });
  });
});
