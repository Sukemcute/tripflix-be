import { describe, expect, it, vi } from 'vitest';
import type { AvailabilityResult, CatalogFlight, CatalogPage, CheckAvailabilityQuery, ListCatalogQuery } from '../../../commerce/index.js';
import type { StaysUseCases } from '../../search/application/stays.use-cases.js';
import { TripBuilderUseCases, type TripBuilderCommerce } from './trip-builder.use-cases.js';

const flight = (id: string, from: string, to: string, provinceSlug: string, departTime: string, arriveTime: string): CatalogFlight => ({
  type: 'flight',
  id,
  name: id,
  airline: 'Vietjet Air',
  fromAirport: from,
  toAirport: to,
  departTime,
  arriveTime,
  province: { slug: provinceSlug, name: provinceSlug },
  priceFrom: null,
  isAvailable: true,
  options: [],
});

const available = (productId: string, unitPrice: number): AvailabilityResult => ({
  productId,
  isFound: true,
  isAvailable: true,
  optionId: `${productId}--ECO`,
  reason: null,
  roomsNeeded: null,
  remaining: 9,
  totalPrice: unitPrice * 2,
  unitPrice,
  ratePlanCode: 'ECO',
});

function setup(catalog: Record<string, CatalogFlight[]>, prices: Record<string, number | null>) {
  const listCatalog = vi.fn((q: ListCatalogQuery): Promise<CatalogPage> =>
    Promise.resolve({ from: '', to: '', items: catalog[q.provinceSlug ?? ''] ?? [], nextCursor: null }),
  );
  const checkAvailability = vi.fn((q: CheckAvailabilityQuery) =>
    Promise.resolve(
      q.productIds.map((id) =>
        prices[id] ? available(id, prices[id]) : { ...available(id, 0), isAvailable: false, optionId: null, unitPrice: null, totalPrice: null },
      ),
    ),
  );
  const listStays = vi.fn();
  const useCases = new TripBuilderUseCases(
    { listCatalog, checkAvailability } as unknown as TripBuilderCommerce,
    { listStays } as unknown as StaysUseCases,
  );
  return { useCases, checkAvailability, listStays };
}

describe('TripBuilderUseCases.suggestFlights (TF105)', () => {
  const catalog = {
    'nha-trang': [
      flight('VJ135', 'SGN', 'CXR', 'nha-trang', '06:45', '08:20'),
      flight('VN211', 'SGN', 'CXR', 'nha-trang', '17:00', '18:35'),
      flight('VJ777', 'HAN', 'CXR', 'nha-trang', '07:00', '09:00'),
      flight('SOLD', 'SGN', 'CXR', 'nha-trang', '09:00', '10:35'),
    ],
    'ho-chi-minh': [
      flight('VN202', 'CXR', 'SGN', 'ho-chi-minh', '16:30', '18:05'),
      flight('VJ300', 'DLI', 'SGN', 'ho-chi-minh', '08:00', '09:00'),
    ],
  };
  const prices = { VJ135: 950_000, VN211: 1_000_000, VJ777: 800_000, VN202: 920_000, VJ300: 500_000, SOLD: null };

  it('chiều đi từ đúng sân bay nhà, chiều về từ sân bay nơi đến, bỏ chuyến hết chỗ, giá đúng ngày', async () => {
    const { useCases, checkAvailability } = setup(catalog, prices);
    const result = await useCases.suggestFlights({
      place: 'nha-trang',
      from: 'SGN',
      departDate: '2026-12-01',
      returnDate: '2026-12-03',
      adults: 2,
      sort: 'cheapest',
      limit: 5,
    });
    expect(result!.outbound.map((f) => [f.flightId, f.productId, f.totalPrice])).toEqual([
      ['VJ135', 'VJ135--ECO', 1_900_000],
      ['VN211', 'VN211--ECO', 2_000_000],
    ]);
    expect(result!.inbound.map((f) => f.flightId)).toEqual(['VN202']);
    expect(checkAvailability).toHaveBeenCalledWith(expect.objectContaining({ checkIn: '2026-12-03', adults: 2 }));
  });

  it('không có ngày về thì chỉ chiều đi; nơi hoặc sân bay lạ thì null', async () => {
    const { useCases } = setup(catalog, prices);
    const oneWay = await useCases.suggestFlights({ place: 'nha-trang', from: 'SGN', departDate: '2026-12-01', adults: 1, sort: 'best_time', limit: 1 });
    expect(oneWay).toMatchObject({ outbound: [{ flightId: 'VJ135' }], inbound: [] });
    expect(await useCases.suggestFlights({ place: 'khong-co', from: 'SGN', departDate: '2026-12-01', adults: 1, sort: 'cheapest', limit: 5 })).toBeNull();
    expect(await useCases.suggestFlights({ place: 'nha-trang', from: 'XXX', departDate: '2026-12-01', adults: 1, sort: 'cheapest', limit: 5 })).toBeNull();
  });
});

describe('TripBuilderUseCases.suggestStays (TF105)', () => {
  it('lấy khách sạn còn phòng từ /stays, bỏ chỗ thiếu mã phòng, xếp và cắt theo limit', async () => {
    const { useCases, listStays } = setup({}, {});
    const stay = (hotelId: string, unitPrice: number, average: number | null, roomProductId: string | null) => ({
      hotelId,
      slug: null,
      name: hotelId,
      stars: 3,
      thumbnail: null,
      province: { slug: 'nha-trang', name: 'Nha Trang' },
      unitPrice,
      totalPrice: unitPrice * 2,
      rating: average === null ? null : { average, count: 10 },
      roomProductId,
      ratePlanCode: roomProductId ? 'RO' : null,
    });
    listStays.mockResolvedValue({
      items: [stay('a', 330_000, 4.4, 'a--STD'), stay('b', 3_320_000, 4.9, 'b--DLX'), stay('c', 100_000, 5, null)],
      total: 3,
      nextCursor: null,
    });
    const items = await useCases.suggestStays({ place: 'nha-trang', checkIn: '2026-12-01', checkOut: '2026-12-03', adults: 2, sort: 'top_rated', limit: 1 });
    expect(items).toEqual([expect.objectContaining({ hotelId: 'b', roomProductId: 'b--DLX', ratePlanCode: 'RO' })]);
    expect(listStays).toHaveBeenCalledWith(expect.objectContaining({ placeId: 'nha-trang', sort: 'price' }));

    listStays.mockResolvedValue(null);
    expect(await useCases.suggestStays({ place: 'khong-co', checkIn: '2026-12-01', checkOut: '2026-12-03', adults: 2, sort: 'best_price', limit: 5 })).toBeNull();
  });
});
