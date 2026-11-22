import { describe, expect, it, vi } from 'vitest';
import type { AvailabilityResult, CatalogFlight, CatalogHotel, CatalogPage, CheckAvailabilityQuery, ListCatalogQuery } from '../../../commerce/index.js';
import type { StayPage } from '../../search/application/stays.use-cases.js';
import { TripAddonUseCases, type TripAddonCommerce, type TripAddonProductFeatures, type TripAddonQuery, type TripAddonStays } from './trip-addons.use-cases.js';

const hotel = (id: string, provinceSlug: string, provinceName: string): CatalogHotel => ({
  type: 'hotel',
  id,
  name: `KS ${id}`,
  province: { slug: provinceSlug, name: provinceName },
  city: null,
  stars: 4,
  brand: null,
  style: null,
  thumbnail: null,
  images: [],
  priceFrom: null,
  isAvailable: true,
  options: [],
  address: null,
  location: null,
});

const flight = (id: string, fromAirport: string, toAirport: string, provinceSlug: string, departTime = '08:00'): CatalogFlight => ({
  type: 'flight',
  id,
  name: `${fromAirport} – ${toAirport}`,
  airline: 'VN',
  fromAirport,
  toAirport,
  departTime,
  arriveTime: null,
  province: { slug: provinceSlug, name: provinceSlug },
  priceFrom: null,
  isAvailable: true,
  options: [],
});

const CATALOG = {
  hotel: [{ ...hotel('H-NT', 'nha-trang', 'Nha Trang'), location: { lat: 12.265, lng: 109.195 } }, hotel('H-DL', 'da-lat', 'Đà Lạt')],
  flight: [
    flight('F-SGN-CXR-1', 'SGN', 'CXR', 'khanh-hoa', '09:00'),
    flight('F-SGN-CXR-2', 'SGN', 'CXR', 'nha-trang', '06:00'),
    flight('F-HAN-CXR', 'HAN', 'CXR', 'khanh-hoa'),
    flight('F-CXR-SGN', 'CXR', 'SGN', 'ho-chi-minh'),
    flight('F-CXR-HAN', 'CXR', 'HAN', 'ha-noi'),
    flight('F-SGN-DLI', 'SGN', 'DLI', 'lam-dong'),
    flight('F-DLI-SGN', 'DLI', 'SGN', 'ho-chi-minh'),
  ],
};

/** Giá theo mã chuyến; null = hết chỗ ngày đó. */
const PRICES: Record<string, number | null> = { 'F-SGN-DLI': 800_000, 'F-DLI-SGN': 700_000, 'F-SGN-CXR-1': 900_000, 'F-SGN-CXR-2': 900_000, 'F-HAN-CXR': 1_500_000, 'F-CXR-SGN': null, 'F-CXR-HAN': 1_400_000 };

function setup(pageSize = 2) {
  const listCatalog = vi.fn((q: ListCatalogQuery): Promise<CatalogPage> => {
    const all = CATALOG[q.type ?? 'hotel'];
    const start = q.cursor ? Number(q.cursor) : 0;
    const end = start + pageSize;
    return Promise.resolve({ from: '', to: '', items: all.slice(start, end), nextCursor: end < all.length ? String(end) : null });
  });
  const checkAvailability = vi.fn((q: CheckAvailabilityQuery): Promise<AvailabilityResult[]> =>
    Promise.resolve(
      q.productIds.map((productId) => {
        const unitPrice = PRICES[productId] ?? null;
        return {
          productId,
          isFound: true,
          isAvailable: unitPrice !== null,
          optionId: unitPrice === null ? null : `${productId}--Y`,
          reason: unitPrice === null ? 'SOLD_OUT' : null,
          roomsNeeded: null,
          remaining: unitPrice === null ? 0 : 5,
          totalPrice: unitPrice === null ? null : unitPrice * q.adults,
          unitPrice,
          ratePlanCode: unitPrice === null ? null : 'ECO',
        } satisfies AvailabilityResult;
      }),
    ),
  );
  const stayOf = (hotelId: string, unitPrice: number) => ({
    hotelId,
    slug: null,
    name: hotelId,
    stars: 4,
    thumbnail: null,
    province: { slug: 'khanh-hoa', name: 'Khánh Hòa' },
    unitPrice,
    totalPrice: unitPrice * 3,
    rating: null,
  });
  const listStays = vi.fn((): Promise<StayPage | null> => Promise.resolve({ items: [stayOf('H-NT', 500_000)], total: 1, nextCursor: null }));
  // Hồ sơ hotel_profile@v0 do job dựng sẵn: khách sạn cách Tháp Bà 200 m.
  const findProductFeatures = vi.fn((_key: string, ids: string[]) =>
    Promise.resolve(
      new Map(
        ids
          .filter((id) => id === 'H-NT')
          .map((id) => [
            id,
            {
              score: 0.5,
              features: {
                priceFrom: 500_000, priceTier: 0, valueRatio: null, ratingAverage: null, ratingCount: 0, ratingScore: null,
                nearestSightName: 'Tháp Bà', nearestSightKm: 0.2, placesNearby: 3, bookings30d: 0, popularity: 0,
              },
            },
          ]),
      ),
    ),
  );
  const useCases = new TripAddonUseCases(
    { listCatalog, checkAvailability } as unknown as TripAddonCommerce,
    { listStays } as TripAddonStays,
    { findProductFeatures } as TripAddonProductFeatures,
  );
  return { useCases, listCatalog, checkAvailability, listStays, findProductFeatures };
}

const query = (overrides: Partial<TripAddonQuery>): TripAddonQuery => ({ items: [], adults: 2, perGroup: 3, ...overrides });

describe('TripAddonUseCases.suggest', () => {
  it('đặt phòng Nha Trang: gợi ý vé tới CXR (cả chuyến ghi khanh-hoa), mặc định bay từ SGN, đúng ngày, giá thật', async () => {
    const { useCases, checkAvailability } = setup();
    const result = await useCases.suggest(query({ items: [{ type: 'hotel', hotelId: 'H-NT', checkIn: '2026-12-01', checkOut: '2026-12-03' }] }));

    expect(result.missing).toBe('flight');
    expect(result.stays).toBeNull();
    expect(result.flights).toMatchObject({ destination: { slug: 'nha-trang' }, fromAirport: 'SGN', origins: ['HAN', 'SGN'], departDate: '2026-12-01', returnDate: '2026-12-03' });
    // Cùng giá thì bay sớm trước.
    expect(result.flights!.outbound.items.map((f) => [f.flightKey, f.productId, f.date, f.totalPrice])).toEqual([
      ['F-SGN-CXR-2', 'F-SGN-CXR-2--Y', '2026-12-01', 1_800_000],
      ['F-SGN-CXR-1', 'F-SGN-CXR-1--Y', '2026-12-01', 1_800_000],
    ]);
    // Chiều về CXR → SGN hết chỗ ngày 03/12 thì danh sách rỗng, không lấy nhầm chuyến về HAN.
    expect(result.flights!.outbound.groups.find((g) => g.code === 'cheapest')!.ids).toEqual(['F-SGN-CXR-2', 'F-SGN-CXR-1']);
    expect(result.flights!.inbound).toMatchObject({ items: [], groups: [] });
    expect(checkAvailability).toHaveBeenCalledWith(expect.objectContaining({ checkIn: '2026-12-03', productIds: ['F-CXR-SGN'], adults: 2 }));
  });

  it('chọn bay từ HAN thì đổi cả chiều đi lẫn chiều về', async () => {
    const { useCases } = setup();
    const result = await useCases.suggest(query({ fromAirport: 'HAN', items: [{ type: 'hotel', hotelId: 'H-NT', checkIn: '2026-12-01', checkOut: '2026-12-03' }] }));
    expect(result.flights!.fromAirport).toBe('HAN');
    expect(result.flights!.outbound.items.map((f) => f.flightKey)).toEqual(['F-HAN-CXR']);
    expect(result.flights!.inbound.items.map((f) => f.flightKey)).toEqual(['F-CXR-HAN']);
  });

  it('hai khách sạn hai nơi (Đà Lạt rồi Nha Trang): đi tới DLI, về từ CXR', async () => {
    const { useCases, checkAvailability } = setup();
    const result = await useCases.suggest(
      query({
        items: [
          { type: 'hotel', hotelId: 'H-DL', checkIn: '2026-12-01', checkOut: '2026-12-03' },
          { type: 'hotel', hotelId: 'H-NT', checkIn: '2026-12-03', checkOut: '2026-12-05' },
        ],
      }),
    );
    expect(result.flights).toMatchObject({ destination: { slug: 'da-lat' }, fromAirport: 'SGN', departDate: '2026-12-01', returnDate: '2026-12-05' });
    expect(result.flights!.outbound.items.map((f) => f.flightKey)).toEqual(['F-SGN-DLI']);
    // Chiều về hỏi chuyến CXR → SGN (đang hết chỗ), không lấy DLI → SGN dù còn chỗ.
    expect(checkAvailability).toHaveBeenCalledWith(expect.objectContaining({ checkIn: '2026-12-05', productIds: ['F-CXR-SGN'] }));
    expect(result.flights!.inbound.items).toEqual([]);
  });

  it('khách sạn không còn trong danh mục: biết là thiếu vé nhưng không có gợi ý', async () => {
    const { useCases } = setup();
    expect(await useCases.suggest(query({ items: [{ type: 'hotel', hotelId: 'H-GONE', checkIn: '2026-12-01', checkOut: '2026-12-03' }] }))).toEqual({
      missing: 'flight',
      flights: null,
      stays: null,
    });
  });

  it('có vé tới CXR: gợi ý khách sạn ở mọi nơi CXR phục vụ (Khánh Hòa, Nha Trang), từ ngày đi tới ngày về', async () => {
    const { useCases, listStays, findProductFeatures } = setup();
    const result = await useCases.suggest(
      query({
        rooms: 1,
        items: [
          { type: 'flight', fromAirport: 'SGN', toAirport: 'CXR', date: '2026-12-01' },
          { type: 'flight', fromAirport: 'CXR', toAirport: 'SGN', date: '2026-12-04' },
        ],
      }),
    );
    expect(result).toMatchObject({ missing: 'hotel', flights: null, stays: { place: { slug: 'nha-trang', name: 'Nha Trang' }, checkIn: '2026-12-01', checkOut: '2026-12-04' } });
    expect(listStays).toHaveBeenCalledWith(expect.objectContaining({ placeId: 'khanh-hoa', checkIn: '2026-12-01', checkOut: '2026-12-04', adults: 2, rooms: 1, sort: 'price' }));
    expect(listStays).toHaveBeenCalledWith(expect.objectContaining({ placeId: 'nha-trang' }));
    // Hồ sơ đọc từ bảng hotel_profile@v0, ranker trip_stays@v0 chia nhóm.
    expect(findProductFeatures).toHaveBeenCalledWith('hotel_profile@v0', ['H-NT']);
    expect(result.stays!.items[0]).toMatchObject({ hotelId: 'H-NT', nearestSight: { name: 'Tháp Bà', km: 0.2 }, budgetFit: 1 });
    expect(result.stays!.groups.map((g) => g.code)).toEqual(['cheap', 'near_sights']);
    expect(result.stays!.budget).toBe('moderate');
  });

  it('đủ phòng và vé: không gọi commerce', async () => {
    const { useCases, listCatalog } = setup();
    const result = await useCases.suggest(
      query({
        items: [
          { type: 'hotel', hotelId: 'H-NT', checkIn: '2026-12-01', checkOut: '2026-12-03' },
          { type: 'flight', fromAirport: 'SGN', toAirport: 'CXR', date: '2026-12-01' },
        ],
      }),
    );
    expect(result).toEqual({ missing: null, flights: null, stays: null });
    expect(listCatalog).not.toHaveBeenCalled();
  });
});
