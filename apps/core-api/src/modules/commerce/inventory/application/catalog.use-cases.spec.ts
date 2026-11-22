import { CommerceError } from '../domain/errors.js';
import { MemoryCommerceStore } from '../infra/memory/memory-commerce.store.js';
import { CalendarUseCases } from './calendar.use-cases.js';
import { CatalogUseCases } from './catalog.use-cases.js';

const TODAY = '2026-12-01';
const plans = [
  { code: 'RO', name: 'Chỉ phòng', meal: 'none', refundable: true, freeCancelDays: 3, priceFactor: 1 },
  { code: 'BB', name: 'Kèm ăn sáng', meal: 'breakfast', refundable: true, freeCancelDays: 3, priceFactor: 1.2 },
];

async function setup() {
  const store = new MemoryCommerceStore();
  for (const [id, province] of [['H1', 'da-nang'], ['H2', 'da-nang'], ['H3', 'phu-quoc']] as const) {
    store.properties.push({ id, slug: `khach-san-${id.toLowerCase()}`, name: `Khách sạn ${id}`, provinceSlug: province, provinceName: province, city: null, stars: 4, brand: null, style: null, thumbnail: `/img/${id}.jpg`, images: [`/img/${id}.jpg`], ...(id === 'H1' ? { address: '1 Bạch Đằng, Đà Nẵng', lat: 16.07, lng: 108.22, ratingAvg: 4.5, reviewCount: 77 } : {}) });
  }
  store.roomTypes.push(
    { id: 'H1--STD', propertyId: 'H1', name: 'Tiêu chuẩn', maxGuests: 2, defaultTotal: 3, defaultPrice: 1_000_000, ratePlans: plans },
    { id: 'H1--FAM', propertyId: 'H1', name: 'Gia đình', maxGuests: 4, defaultTotal: 2, defaultPrice: 2_000_000, ratePlans: plans },
    { id: 'H2--STD', propertyId: 'H2', name: 'Tiêu chuẩn', maxGuests: 2, defaultTotal: 1, defaultPrice: 800_000, ratePlans: plans },
    { id: 'H3--STD', propertyId: 'H3', name: 'Tiêu chuẩn', maxGuests: 2, defaultTotal: 1, defaultPrice: 900_000, ratePlans: plans },
  );
  store.flights.push(
    { id: 'F1--Y', flightKey: 'F1', name: 'Bay Hà Nội – Đà Nẵng', airline: 'VN', fromAirport: 'HAN', toAirport: 'DAD', departTime: '06:30', arriveTime: null, destinationSlug: 'da-nang', destinationName: 'Đà Nẵng', cabinName: 'Phổ thông', defaultSeats: 3, defaultPrice: 1_500_000, farePlans: plans },
    { id: 'F1--C', flightKey: 'F1', name: 'Bay Hà Nội – Đà Nẵng', airline: 'VN', fromAirport: 'HAN', toAirport: 'DAD', departTime: '06:30', arriveTime: null, destinationSlug: 'da-nang', destinationName: 'Đà Nẵng', cabinName: 'Thương gia', defaultSeats: 2, defaultPrice: 4_000_000, farePlans: plans },
  );
  const today = () => TODAY;
  await new CalendarUseCases(store, today).openCalendarWindow(30);
  // Bỏ ngẫu nhiên khỏi test: mọi ngày mở bán bình thường.
  for (const key of store.roomDays.keys()) {
    const [id, date] = key.split('|') as [string, string];
    store.patchRoomDay(id, date, { isStopSell: false, isClosedToArrival: false, isClosedToDeparture: false, minLos: 1 });
  }
  for (const [key, d] of store.flightDays) store.flightDays.set(key, { ...d, isStopSell: false });
  return { store, catalog: new CatalogUseCases(store, today) };
}

describe('CalendarUseCases.openCalendarWindow', () => {
  it('mở đủ cửa sổ cho mọi loại phòng và hạng ghế; chạy lại không thêm, không đè ngày đã bán', async () => {
    const { store } = await setup();
    expect(store.roomDays.size).toBe(4 * 30);
    expect(store.flightDays.size).toBe(2 * 30);
    store.patchRoomDay('H1--STD', TODAY, { sold: 2 });
    const again = await new CalendarUseCases(store, () => TODAY).openCalendarWindow(30);
    expect(again).toEqual({ roomDays: 0, flightDays: 0 });
    expect(store.roomDays.get(`H1--STD|${TODAY}`)!.sold).toBe(2);
    const nextDay = await new CalendarUseCases(store, () => '2026-12-02').openCalendarWindow(30);
    expect(nextDay).toEqual({ roomDays: 4, flightDays: 2 });
  });
});

describe('CatalogUseCases.listCatalog', () => {
  it('khách sạn có tỉnh, ảnh, giá thấp nhất và các loại phòng; lọc theo tỉnh', async () => {
    const { catalog } = await setup();
    const page = await catalog.listCatalog({ provinceSlug: 'da-nang' });
    expect(page.items.map((i) => i.id)).toEqual(['H1', 'H2']);
    const h1 = page.items[0]!;
    expect(h1).toMatchObject({ type: 'hotel', province: { slug: 'da-nang' }, thumbnail: '/img/H1.jpg', isAvailable: true, address: '1 Bạch Đằng, Đà Nẵng', location: { lat: 16.07, lng: 108.22 }, rating: { average: 4.5, count: 77 } });
    expect(page.items[1]).toMatchObject({ id: 'H2', address: null, location: null, rating: null });
    expect(h1.options.map((o) => o.productId)).toEqual(['H1--STD', 'H1--FAM']);
    expect(h1.priceFrom).toBe(h1.options[0]!.priceFrom);
    expect(h1.options[0]!.availableDays).toBe(30);
  });

  it('phân trang theo con trỏ: đi hết không trùng, không sót', async () => {
    const { catalog } = await setup();
    const first = await catalog.listCatalog({ limit: 2 });
    const second = await catalog.listCatalog({ limit: 2, cursor: first.nextCursor });
    expect([...first.items, ...second.items].map((i) => i.id)).toEqual(['H1', 'H2', 'H3']);
    expect(second.nextCursor).toBeNull();
  });

  it('hết phòng cả cửa sổ thì không còn bán, giá thấp nhất là null', async () => {
    const { store, catalog } = await setup();
    for (const key of store.roomDays.keys()) if (key.startsWith('H2--')) store.patchRoomDay('H2--STD', key.split('|')[1]!, { sold: 1 });
    const h2 = (await catalog.listCatalog({ provinceSlug: 'da-nang' })).items[1]!;
    expect(h2).toMatchObject({ id: 'H2', isAvailable: false, priceFrom: null });
  });

  it('chuyến bay gom các hạng ghế; tham số sai thì báo lỗi', async () => {
    const { catalog } = await setup();
    const page = await catalog.listCatalog({ type: 'flight' });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ type: 'flight', id: 'F1', fromAirport: 'HAN', toAirport: 'DAD' });
    expect(page.items[0]!.options.map((o) => o.productId)).toEqual(['F1--Y', 'F1--C']);
    await expect(catalog.listCatalog({ limit: 0 })).rejects.toBeInstanceOf(CommerceError);
  });
});

describe('CatalogUseCases.checkAvailability', () => {
  const stay = { checkIn: '2026-12-05', checkOut: '2026-12-07', adults: 2 };

  it('mã khách sạn: trả loại phòng rẻ nhất còn đủ chỗ, giữ thứ tự, mã lạ thì isFound = false', async () => {
    const { catalog } = await setup();
    const results = await catalog.checkAvailability({ productIds: ['H2', 'KHONG-CO', 'H1'], ...stay });
    expect(results.map((r) => r.productId)).toEqual(['H2', 'KHONG-CO', 'H1']);
    expect(results[0]).toMatchObject({ isAvailable: true, optionId: 'H2--STD', roomsNeeded: 1 });
    expect(results[1]).toMatchObject({ isFound: false, isAvailable: false });
    expect(results[2]).toMatchObject({ isAvailable: true, optionId: 'H1--STD' });
    expect(results[2]!.totalPrice).toBe(results[2]!.unitPrice! * 2);
  });

  it('nhóm đông: tự tính số phòng; loại rẻ không đủ phòng thì chọn loại còn đủ', async () => {
    const { catalog } = await setup();
    const [h1] = await catalog.checkAvailability({ productIds: ['H1'], ...stay, adults: 7 });
    // Tiêu chuẩn cần 4 phòng nhưng chỉ có 3; Gia đình cần 2 phòng, còn đủ.
    expect(h1).toMatchObject({ isAvailable: true, optionId: 'H1--FAM', roomsNeeded: 2 });
  });

  it('hết phòng một đêm thì báo lý do; chuyến bay theo số khách', async () => {
    const { store, catalog } = await setup();
    store.patchRoomDay('H2--STD', '2026-12-06', { sold: 1 });
    const [h2, flight] = await catalog.checkAvailability({ productIds: ['H2', 'F1'], ...stay });
    expect(h2).toMatchObject({ isAvailable: false, reason: 'SOLD_OUT', remaining: 0 });
    expect(flight).toMatchObject({ isAvailable: true, optionId: 'F1--Y', remaining: 3 });
  });

  it('kiểm tham số: ngày quá khứ, thiếu ngày trả phòng, số khách sai', async () => {
    const { catalog } = await setup();
    await expect(catalog.checkAvailability({ productIds: ['H1'], checkIn: '2026-11-30', checkOut: '2026-12-02', adults: 2 })).rejects.toMatchObject({ field: 'checkIn' });
    await expect(catalog.checkAvailability({ productIds: ['H1'], checkIn: '2026-12-05', adults: 2 })).rejects.toMatchObject({ field: 'checkOut' });
    await expect(catalog.checkAvailability({ productIds: ['H1'], ...stay, adults: 0 })).rejects.toMatchObject({ field: 'adults' });
    // Chỉ có chuyến bay thì không cần ngày trả phòng.
    await expect(catalog.checkAvailability({ productIds: ['F1--C'], checkIn: '2026-12-05', adults: 1 })).resolves.toHaveLength(1);
  });
});
