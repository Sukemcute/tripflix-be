import { describe, expect, it, vi } from 'vitest';
import type { PointOfInterestSeed } from '../../search/domain/points-of-interest.js';
import type { ProductBuildOutput } from '../domain/contracts.js';
import { BuildProductFeaturesUseCases } from './build-product-features.use-cases.js';
import type { FlightProfileSource, HotelProfileSource, ProductFeatureStore, ProductProfileCatalog, RecommendStore } from './ports.js';

const hotel = (id: string, roomProductIds: string[]): HotelProfileSource => ({
  id,
  provinceSlug: 'nha-trang',
  city: 'Nha Trang',
  stars: 4,
  priceFrom: 800_000,
  rating: { average: 4.5, count: 100 },
  location: { lat: 12.25, lng: 109.19 },
  roomProductIds,
});
const flight = (flightKey: string, cabinProductIds: string[]): FlightProfileSource => ({
  flightKey,
  fromAirport: 'SGN',
  toAirport: 'CXR',
  airline: 'VN',
  departTime: '06:45',
  arriveTime: '08:20',
  priceFrom: 900_000,
  hasRefundableFare: true,
  cabinProductIds,
});

function setup(opts: { hotels: HotelProfileSource[]; flights?: FlightProfileSource[]; failHotels?: boolean }) {
  const saved: Array<{ key: string; type: string; rows: ProductBuildOutput[] }> = [];
  const setJobState = vi.fn(() => Promise.resolve());
  const store = { withLock: <T>(_: string, fn: () => Promise<T>) => fn(), setJobState } as unknown as Pick<RecommendStore, 'withLock' | 'setJobState'>;
  const features: ProductFeatureStore = {
    countProductBookings: () => Promise.resolve(new Map([['H1--DLX', 2], ['H1--STD', 1], ['F1--Y', 3]])),
    replaceProductFeatures: (key, type, rows) =>
      opts.failHotels && type === 'hotel' ? Promise.reject(new Error('db down')) : (saved.push({ key, type, rows }), Promise.resolve()),
    findProductFeatures: () => Promise.resolve(new Map()),
  };
  // Khách sạn hai trang để thử vòng lặp con trỏ.
  const hotels = opts.hotels;
  const catalog: ProductProfileCatalog = {
    listHotelProfiles: (cursor) => Promise.resolve(cursor ? { items: hotels.slice(1), nextCursor: null } : { items: hotels.slice(0, 1), nextCursor: hotels.length > 1 ? '1' : null }),
    listFlightProfiles: () => Promise.resolve({ items: opts.flights ?? [], nextCursor: null }),
  };
  const point = (name: string, kind: PointOfInterestSeed['kind']): PointOfInterestSeed => ({ id: name, name, kind, lat: 12.251, lng: 109.19, cityId: 'nha-trang', tags: [], popularity: 0 });
  const places = { listPoints: () => Promise.resolve([point('Tháp Bà', 'see'), point('Nhà nghỉ', 'lodging')]) };
  return { useCases: new BuildProductFeaturesUseCases(store, features, catalog, places), saved, setJobState };
}

describe('BuildProductFeaturesUseCases.runCycle', () => {
  it('dựng cả khách sạn và chuyến bay; lượt đặt cộng theo mọi loại phòng / hạng ghế; bỏ chỗ ở OSM khỏi điểm đi chơi', async () => {
    const { useCases, saved, setJobState } = setup({ hotels: [hotel('H1', ['H1--DLX', 'H1--STD']), hotel('H2', ['H2--STD'])], flights: [flight('F1', ['F1--Y', 'F1--C'])] });
    expect(await useCases.runCycle(new Date('2026-11-17T00:00:00Z'))).toEqual({ hotels: 2, flights: 1, failedBuilders: [] });
    const hotels = saved.find((s) => s.type === 'hotel')!;
    expect(hotels.key).toBe('hotel_profile@v0');
    expect(hotels.rows.find((o) => o.productId === 'H1')!.features).toMatchObject({ bookings30d: 3, popularity: 1, nearestSightName: 'Tháp Bà', placesNearby: 1 });
    const flights = saved.find((s) => s.type === 'flight')!;
    expect(flights).toMatchObject({ key: 'flight_profile@v0', rows: [{ productId: 'F1', groupKey: 'SGN-CXR', features: { bookings30d: 3, hasRefundableFare: true } }] });
    expect(setJobState).toHaveBeenCalledWith('flight_profile@v0', expect.objectContaining({ lastError: null }));
  });

  it('danh mục rỗng: không xoá hồ sơ cũ', async () => {
    const { useCases, saved } = setup({ hotels: [] });
    expect(await useCases.runCycle()).toEqual({ hotels: 0, flights: 0, failedBuilders: [] });
    expect(saved).toEqual([]);
  });

  it('builder khách sạn lỗi: ghi lastError, builder chuyến bay vẫn chạy, không ném', async () => {
    const { useCases, saved, setJobState } = setup({ hotels: [hotel('H1', [])], flights: [flight('F1', [])], failHotels: true });
    expect(await useCases.runCycle()).toEqual({ hotels: 0, flights: 1, failedBuilders: ['hotel_profile@v0'] });
    expect(setJobState).toHaveBeenCalledWith('hotel_profile@v0', expect.objectContaining({ lastError: 'db down' }));
    expect(saved.map((s) => s.type)).toEqual(['flight']);
  });
});
