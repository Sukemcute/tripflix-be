import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CatalogHotel, CatalogPage } from '../../../commerce/index.js';
import { HomeRecommendationUseCases, type HomeCommerce } from './home-recommendations.use-cases.js';

const hotel = (id: string, slug: string, stars: number, priceFrom: number | null): CatalogHotel => ({
  type: 'hotel',
  id,
  name: id,
  province: { slug, name: slug },
  city: null,
  stars,
  brand: null,
  style: null,
  thumbnail: null,
  images: [],
  priceFrom,
  isAvailable: priceFrom !== null,
  options: [],
  address: null,
  location: null,
});

describe('HomeRecommendationUseCases', () => {
  it('đọc hết danh mục theo con trỏ, bỏ khách sạn không có giá, và giữ cache cho lần sau', async () => {
    const pages: CatalogPage[] = [
      { from: '', to: '', items: [hotel('a', 'da-lat', 5, 3_000_000), hotel('sold-out', 'da-lat', 5, null)], nextCursor: 'sold-out' },
      { from: '', to: '', items: [hotel('b', 'lam-dong', 4, 1_000_000)], nextCursor: null },
    ];
    const listCatalog = vi.fn((q: { cursor?: string | null }) => Promise.resolve(q.cursor ? pages[1]! : pages[0]!));
    const useCases = new HomeRecommendationUseCases({ listCatalog } as unknown as HomeCommerce);

    const picks = await useCases.recommendForHome({ recentPlaceIds: ['lam-dong'], limit: 8 });
    await useCases.recommendForHome({ recentPlaceIds: [], limit: 8 });

    expect(picks.map((p) => p.hotels[0]?.hotelId)).toEqual(['a', 'b']);
    expect(listCatalog).toHaveBeenCalledTimes(2);
    expect(listCatalog).toHaveBeenCalledWith(expect.objectContaining({ type: 'hotel', days: 30, limit: 200 }));
  });

  afterEach(() => vi.useRealTimers());

  const onePage = (items: CatalogHotel[]): CatalogPage => ({ from: '', to: '', items, nextCursor: null });

  it('nhiều request tới lúc chưa có cache chỉ đọc danh mục một lần', async () => {
    const listCatalog = vi.fn(() => Promise.resolve(onePage([hotel('a', 'da-lat', 5, 3_000_000)])));
    const useCases = new HomeRecommendationUseCases({ listCatalog } as unknown as HomeCommerce);

    await Promise.all(Array.from({ length: 20 }, () => useCases.recommendForHome({ recentPlaceIds: [], limit: 8 })));

    expect(listCatalog).toHaveBeenCalledTimes(1);
  });

  it('cùng tham số thì dùng lại kết quả đã tính cho tới lần đọc danh mục sau', async () => {
    const listCatalog = vi.fn(() => Promise.resolve(onePage([hotel('a', 'da-lat', 5, 3_000_000)])));
    const useCases = new HomeRecommendationUseCases({ listCatalog } as unknown as HomeCommerce);

    const first = await useCases.recommendForHome({ recentPlaceIds: ['da-lat'], limit: 8 });
    const again = await useCases.recommendForHome({ recentPlaceIds: ['da-lat'], limit: 8 });
    const other = await useCases.recommendForHome({ recentPlaceIds: [], limit: 8 });

    expect(again).toBe(first);
    expect(other).not.toBe(first);
  });

  it('cache hết hạn thì trả danh mục cũ ngay, đọc lại ở nền một lần, lần sau thấy danh mục mới', async () => {
    vi.useFakeTimers();
    let price = 3_000_000;
    const listCatalog = vi.fn(() => Promise.resolve(onePage([hotel('a', 'da-lat', 5, price)])));
    const useCases = new HomeRecommendationUseCases({ listCatalog } as unknown as HomeCommerce);
    const query = { recentPlaceIds: ['da-lat'], limit: 8 };
    await useCases.recommendForHome(query);

    price = 2_000_000;
    vi.advanceTimersByTime(11 * 60_000);
    const stale = await Promise.all([useCases.recommendForHome(query), useCases.recommendForHome(query)]);
    expect(stale.map((picks) => picks[0]?.hotels[0]?.priceFrom)).toEqual([3_000_000, 3_000_000]);
    expect(listCatalog).toHaveBeenCalledTimes(2);

    await vi.waitFor(async () => {
      const fresh = await useCases.recommendForHome(query);
      expect(fresh[0]?.hotels[0]?.priceFrom).toBe(2_000_000);
    });
    expect(listCatalog).toHaveBeenCalledTimes(2);
  });

  it('đọc lại ở nền lỗi thì vẫn giữ danh mục cũ', async () => {
    vi.useFakeTimers();
    const listCatalog = vi
      .fn()
      .mockResolvedValueOnce(onePage([hotel('a', 'da-lat', 5, 3_000_000)]))
      .mockRejectedValueOnce(new Error('db down'));
    const useCases = new HomeRecommendationUseCases({ listCatalog } as unknown as HomeCommerce);
    const query = { recentPlaceIds: ['da-lat'], limit: 8 };
    await useCases.recommendForHome(query);

    vi.advanceTimersByTime(11 * 60_000);
    const picks = await useCases.recommendForHome(query);

    expect(picks[0]?.hotels[0]?.hotelId).toBe('a');
  });

  it('danh mục cũ quá 30 phút thì không trả bản cũ nữa: chờ đọc mới', async () => {
    vi.useFakeTimers();
    let price = 3_000_000;
    const listCatalog = vi.fn(() => Promise.resolve(onePage([hotel('a', 'da-lat', 5, price)])));
    const useCases = new HomeRecommendationUseCases({ listCatalog } as unknown as HomeCommerce);
    const query = { recentPlaceIds: ['da-lat'], limit: 8 };
    await useCases.recommendForHome(query);

    price = 2_000_000;
    vi.advanceTimersByTime(31 * 60_000);
    const picks = await useCases.recommendForHome(query);

    expect(picks[0]?.hotels[0]?.priceFrom).toBe(2_000_000);
    expect(listCatalog).toHaveBeenCalledTimes(2);
  });

  it('danh mục cũ quá 30 phút mà đọc lại lỗi thì báo lỗi, không trả bản cũ', async () => {
    vi.useFakeTimers();
    const listCatalog = vi
      .fn()
      .mockResolvedValueOnce(onePage([hotel('a', 'da-lat', 5, 3_000_000)]))
      .mockRejectedValueOnce(new Error('db down'));
    const useCases = new HomeRecommendationUseCases({ listCatalog } as unknown as HomeCommerce);
    const query = { recentPlaceIds: ['da-lat'], limit: 8 };
    await useCases.recommendForHome(query);

    vi.advanceTimersByTime(31 * 60_000);

    await expect(useCases.recommendForHome(query)).rejects.toThrow('db down');
  });
});
