import { describe, expect, it, vi } from 'vitest';
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

    expect(picks.map((p) => p.hotelId)).toEqual(['a', 'b']);
    expect(listCatalog).toHaveBeenCalledTimes(2);
    expect(listCatalog).toHaveBeenCalledWith(expect.objectContaining({ type: 'hotel', days: 30, limit: 200 }));
  });
});
