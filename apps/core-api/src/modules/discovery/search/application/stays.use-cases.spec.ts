import { describe, expect, it, vi } from 'vitest';
import type { AvailabilityResult, CatalogHotel, CatalogPage, CheckAvailabilityQuery, ListCatalogQuery } from '../../../commerce/index.js';
import { StaysUseCases, type ListStaysQuery, type StayCommerce } from './stays.use-cases.js';

const hotel = (id: string, provinceSlug: string, stars: number): CatalogHotel => ({
  type: 'hotel',
  id,
  name: `KS ${id}`,
  province: { slug: provinceSlug, name: provinceSlug },
  city: null,
  stars,
  brand: null,
  style: null,
  thumbnail: `/img/${id}.jpg`,
  images: [],
  priceFrom: null,
  isAvailable: true,
  options: [],
  address: null,
  location: null,
});

const available = (productId: string, unitPrice: number): AvailabilityResult => ({
  productId,
  isFound: true,
  isAvailable: true,
  optionId: `${productId}--STD`,
  reason: null,
  roomsNeeded: 1,
  remaining: 3,
  totalPrice: unitPrice * 2,
  unitPrice,
  ratePlanCode: 'RO',
});

const soldOut = (productId: string): AvailabilityResult => ({ ...available(productId, 0), isAvailable: false, optionId: null, reason: 'SOLD_OUT', totalPrice: null, unitPrice: null });

/** Commerce giả: danh mục theo slug, mặc định 1 khách sạn mỗi trang để thử vòng lặp con trỏ. */
function fakeCommerce(catalog: Record<string, CatalogHotel[]>, prices: Record<string, number | null>, pageSize = 1) {
  const listCatalog = vi.fn((q: ListCatalogQuery): Promise<CatalogPage> => {
    const all = catalog[q.provinceSlug ?? ''] ?? [];
    const start = q.cursor ? all.findIndex((h) => h.id === q.cursor) + 1 : 0;
    const items = all.slice(start, start + pageSize);
    const end = start + items.length;
    return Promise.resolve({ from: '', to: '', items, nextCursor: end < all.length ? items[items.length - 1]!.id : null });
  });
  const checkAvailability = vi.fn((q: CheckAvailabilityQuery) =>
    Promise.resolve(q.productIds.map((id) => (prices[id] ? available(id, prices[id]) : soldOut(id)))),
  );
  return { commerce: { listCatalog, checkAvailability } as unknown as StayCommerce, listCatalog, checkAvailability };
}

const query = (overrides: Partial<ListStaysQuery> = {}): ListStaysQuery => ({
  placeId: 'lam-dong',
  checkIn: '2026-12-01',
  checkOut: '2026-12-03',
  adults: 2,
  sort: 'price',
  limit: 20,
  ...overrides,
});

describe('StaysUseCases.listStays', () => {
  it('gộp khách sạn của tỉnh và điểm đến con, bỏ chỗ hết phòng, rẻ trước, gắn giá thật', async () => {
    const { commerce, listCatalog, checkAvailability } = fakeCommerce(
      { 'lam-dong': [hotel('ld1', 'lam-dong', 3)], 'da-lat': [hotel('dl1', 'da-lat', 4), hotel('dl2', 'da-lat', 5)] },
      { ld1: 900_000, dl1: 600_000, dl2: null },
    );

    const page = await new StaysUseCases(commerce).listStays(query());

    expect(page?.items.map((s) => [s.hotelId, s.unitPrice, s.totalPrice])).toEqual([
      ['dl1', 600_000, 1_200_000],
      ['ld1', 900_000, 1_800_000],
    ]);
    expect(page?.total).toBe(2);
    expect(listCatalog).toHaveBeenCalledWith(expect.objectContaining({ type: 'hotel', provinceSlug: 'da-lat', days: 1 }));
    expect(checkAvailability).toHaveBeenCalledWith(
      expect.objectContaining({ checkIn: '2026-12-01', checkOut: '2026-12-03', adults: 2, productIds: expect.arrayContaining(['ld1', 'dl1', 'dl2']) }),
    );
  });

  it('hỏi còn phòng theo lô tối đa 100 mã', async () => {
    const many = Array.from({ length: 150 }, (_, i) => hotel(`h${i}`, 'da-lat', 3));
    const { commerce, checkAvailability } = fakeCommerce({ 'da-lat': many }, {}, 40);
    await new StaysUseCases(commerce).listStays(query({ placeId: 'da-lat' }));
    expect(checkAvailability.mock.calls.map(([q]) => q.productIds.length)).toEqual([100, 50]);
  });

  it('lọc, sắp theo sao và phân trang trên kết quả còn phòng', async () => {
    const { commerce } = fakeCommerce(
      { 'da-lat': [hotel('a', 'da-lat', 3), hotel('b', 'da-lat', 5), hotel('c', 'da-lat', 4)] },
      { a: 500_000, b: 2_000_000, c: 800_000 },
    );
    const useCases = new StaysUseCases(commerce);

    const first = await useCases.listStays(query({ placeId: 'da-lat', sort: 'stars', minStars: 4, limit: 1 }));
    expect(first).toMatchObject({ items: [{ hotelId: 'b' }], total: 2, nextCursor: '1' });
    const second = await useCases.listStays(query({ placeId: 'da-lat', sort: 'stars', minStars: 4, limit: 1, cursor: '1' }));
    expect(second).toMatchObject({ items: [{ hotelId: 'c' }], nextCursor: null });
  });

  it('nơi lạ thì null; nơi không có khách sạn thì rỗng và không hỏi còn phòng', async () => {
    const { commerce, checkAvailability } = fakeCommerce({}, {});
    const useCases = new StaysUseCases(commerce);
    expect(await useCases.listStays(query({ placeId: 'atlantis' }))).toBeNull();
    expect(await useCases.listStays(query({ placeId: 'da-lat' }))).toEqual({ items: [], total: 0, nextCursor: null });
    expect(checkAvailability).not.toHaveBeenCalled();
  });
});
