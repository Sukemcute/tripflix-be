import { describe, expect, it, vi } from 'vitest';
import { CommerceError } from '../domain/errors.js';
import { addDays, type RoomDay } from '../domain/sales-rules.js';
import { HotelDetailUseCases } from './hotel-detail.use-cases.js';
import type { CommerceStore, PropertyRecord, ReadCalendar, RoomTypeRecord } from './ports.js';

const TODAY = '2026-12-01';
const hotel: PropertyRecord = {
  id: 'H1',
  slug: 'khach-san-h1',
  name: 'Khách sạn H1',
  provinceSlug: 'da-nang',
  provinceName: 'Đà Nẵng',
  city: null,
  stars: null,
  brand: null,
  style: null,
  thumbnail: null,
  images: [],
};
const roomType: RoomTypeRecord = {
  id: 'H1--STD',
  propertyId: hotel.id,
  name: 'Tiêu chuẩn',
  maxGuests: 2,
  defaultTotal: 3,
  defaultPrice: 1_000_000,
  ratePlans: [{ code: 'RO', name: 'Chỉ phòng', meal: 'none', refundable: true, freeCancelDays: 3, priceFactor: 1 }],
};
const stay = { checkIn: TODAY, checkOut: addDays(TODAY, 1), calendarDays: 1 };

function roomDays(price = 1_000_000): Map<string, RoomDay[]> {
  const days: RoomDay[] = Array.from({ length: 4 }, (_, i) => ({
    date: addDays(TODAY, i),
    total: 3,
    held: 0,
    sold: 0,
    price,
    isStopSell: false,
    isClosedToArrival: false,
    isClosedToDeparture: false,
    minLos: 1,
    maxLos: 14,
  }));
  return new Map([[roomType.id, days]]);
}

function setup() {
  const findPropertyBySlugOrId = vi.fn<CommerceStore['catalog']['findPropertyBySlugOrId']>().mockResolvedValue(hotel);
  const findRoomTypesByPropertyIds = vi.fn<CommerceStore['catalog']['findRoomTypesByPropertyIds']>().mockResolvedValue([roomType]);
  const store = { catalog: { findPropertyBySlugOrId, findRoomTypesByPropertyIds } } as unknown as CommerceStore;
  const loadRoomDays = vi.fn<ReadCalendar['loadRoomDays']>().mockResolvedValue(roomDays());
  const calendar: ReadCalendar = {
    loadRoomDays,
    loadFlightDays: vi.fn<ReadCalendar['loadFlightDays']>().mockResolvedValue(new Map()),
  };
  const today = vi.fn(() => TODAY);
  const mediaUrl = vi.fn((key: string) => key);
  const useCases = new HotelDetailUseCases(store, today, mediaUrl, calendar);
  return { useCases, findPropertyBySlugOrId, findRoomTypesByPropertyIds, loadRoomDays };
}

describe('HotelDetailUseCases.getHotelDetail', () => {
  it('dùng chung dữ liệu tĩnh cho cùng slug ở hai kỳ ở khác nhau nhưng đọc lịch mỗi lần', async () => {
    const { useCases, findPropertyBySlugOrId, findRoomTypesByPropertyIds, loadRoomDays } = setup();
    const nextStay = { checkIn: addDays(TODAY, 2), checkOut: addDays(TODAY, 3), calendarDays: 1 };

    const first = await useCases.getHotelDetail(hotel.slug, stay);
    const second = await useCases.getHotelDetail(hotel.slug, nextStay);

    expect(first).toMatchObject({ isAvailable: true, stay: { checkIn: stay.checkIn, checkOut: stay.checkOut } });
    expect(second).toMatchObject({ isAvailable: true, stay: { checkIn: nextStay.checkIn, checkOut: nextStay.checkOut } });
    expect(findPropertyBySlugOrId).toHaveBeenCalledTimes(1);
    expect(findPropertyBySlugOrId).toHaveBeenCalledWith(hotel.slug);
    expect(findRoomTypesByPropertyIds).toHaveBeenCalledTimes(1);
    expect(findRoomTypesByPropertyIds).toHaveBeenCalledWith([hotel.id]);
    expect(loadRoomDays).toHaveBeenCalledTimes(2);
    expect(loadRoomDays).toHaveBeenNthCalledWith(1, [roomType.id], TODAY, stay.checkOut);
    expect(loadRoomDays).toHaveBeenNthCalledWith(2, [roomType.id], TODAY, nextStay.checkOut);
  });

  it('hai lời gọi song song cùng slug chỉ đọc database tĩnh một lần', async () => {
    const { useCases, findPropertyBySlugOrId, findRoomTypesByPropertyIds, loadRoomDays } = setup();
    let resolveProperty!: (value: PropertyRecord | null) => void;
    const pendingProperty = new Promise<PropertyRecord | null>((resolve) => { resolveProperty = resolve; });
    findPropertyBySlugOrId.mockReturnValue(pendingProperty);

    const first = useCases.getHotelDetail(hotel.slug, stay);
    const second = useCases.getHotelDetail(hotel.slug, stay);
    expect(findPropertyBySlugOrId).toHaveBeenCalledTimes(1);
    expect(findRoomTypesByPropertyIds).not.toHaveBeenCalled();
    resolveProperty(hotel);
    const results = await Promise.all([first, second]);

    expect(results).toHaveLength(2);
    for (const result of results) expect(result).toMatchObject({ id: hotel.id, isAvailable: true });
    expect(findPropertyBySlugOrId).toHaveBeenCalledTimes(1);
    expect(findRoomTypesByPropertyIds).toHaveBeenCalledTimes(1);
    expect(findRoomTypesByPropertyIds).toHaveBeenCalledWith([hotel.id]);
    expect(loadRoomDays).toHaveBeenCalledTimes(2);
  });

  it('khách sạn không có thì ném lỗi not_found và lần sau đọc lại database vì không cache lỗi', async () => {
    const { useCases, findPropertyBySlugOrId, findRoomTypesByPropertyIds, loadRoomDays } = setup();
    findPropertyBySlugOrId.mockResolvedValue(null);

    for (let attempt = 1; attempt <= 2; attempt++) {
      const request = useCases.getHotelDetail(hotel.slug, stay);
      await expect(request).rejects.toBeInstanceOf(CommerceError);
      await expect(request).rejects.toMatchObject({ code: 'not_found' });
      expect(findPropertyBySlugOrId).toHaveBeenCalledTimes(attempt);
    }

    expect(findPropertyBySlugOrId).toHaveBeenNthCalledWith(1, hotel.slug);
    expect(findPropertyBySlugOrId).toHaveBeenNthCalledWith(2, hotel.slug);
    expect(findRoomTypesByPropertyIds).not.toHaveBeenCalled();
    expect(loadRoomDays).not.toHaveBeenCalled();
  });

  it('giá lịch thay đổi thì lần gọi sau thấy giá mới dù dữ liệu tĩnh đã được cache', async () => {
    const { useCases, findPropertyBySlugOrId, findRoomTypesByPropertyIds, loadRoomDays } = setup();
    loadRoomDays.mockResolvedValueOnce(roomDays(1_000_000)).mockResolvedValueOnce(roomDays(1_500_000));

    const first = await useCases.getHotelDetail(hotel.slug, stay);
    const second = await useCases.getHotelDetail(hotel.slug, stay);

    for (const [result, price] of [[first, 1_000_000], [second, 1_500_000]] as const) {
      expect(result).toMatchObject({ isAvailable: true, priceFrom: price });
      expect(result.rooms[0]?.ratePlans[0]).toMatchObject({ pricePerNight: price, totalPrice: price });
      expect(result.calendar).toEqual([{ date: TODAY, priceFrom: price, isAvailable: true }]);
    }
    expect(findPropertyBySlugOrId).toHaveBeenCalledTimes(1);
    expect(findRoomTypesByPropertyIds).toHaveBeenCalledTimes(1);
    expect(loadRoomDays).toHaveBeenCalledTimes(2);
  });
});
