import 'reflect-metadata';
import { Global, type INestApplication, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthModule, InvalidAccessTokenError, MemorySidBlocklist } from '@tripflix/auth';
import { MODULES, buildDrizzleToken, createTransactionalPlugins, type Db } from '@tripflix/db';
import { ClsModule } from 'nestjs-cls';
import request from 'supertest';
import type { CoreEnv } from '../../platform/env.js';
import { applyGlobalPrefix } from '../../platform/http.js';
import { CORE_ENV, DB_POOLS, REDIS } from '../../platform/tokens.js';
import { CommerceModule } from './commerce.module.js';
import { CalendarUseCases } from './inventory/application/calendar.use-cases.js';
import { COMMERCE_STORE, TODAY } from './inventory/application/ports.js';
import { MemoryCommerceStore } from './inventory/infra/memory/memory-commerce.store.js';

// E2E chạy app Nest thật (controller, filter, kiểm query), chỉ thay database bằng bản bộ nhớ.
// Module commerce có cả API admin (guard đăng nhập, @Transactional) nên cần đủ CLS và AuthModule, dù API này công khai.
const fakeDrizzle = { transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({}) } as unknown as Db;

@Global()
@Module({
  providers: [
    { provide: CORE_ENV, useValue: { NODE_ENV: 'test', APP_ROLE: 'api', MEDIA_CDN_URL: 'https://cdn.test/' } as CoreEnv },
    { provide: DB_POOLS, useValue: {} },
    { provide: REDIS, useValue: {} },
    ...MODULES.map((m) => ({ provide: buildDrizzleToken(m), useValue: fakeDrizzle })),
  ],
  exports: [CORE_ENV, DB_POOLS, REDIS, ...MODULES.map((m) => buildDrizzleToken(m))],
})
class FakePlatformModule {}

const TODAY_DATE = '2026-12-01';
const plans = [
  { code: 'RO', name: 'Chỉ phòng', meal: 'none', refundable: true, freeCancelDays: 3, priceFactor: 1 },
  { code: 'BB', name: 'Kèm ăn sáng', meal: 'breakfast', refundable: true, freeCancelDays: 3, priceFactor: 1.2 },
];

describe('commerce E2E: GET /api/hotels/:id', () => {
  let app: INestApplication;
  let store: MemoryCommerceStore;

  beforeEach(async () => {
    store = new MemoryCommerceStore();
    store.properties.push({ id: 'H1', name: 'Biển Xanh', provinceSlug: 'da-nang', provinceName: 'Đà Nẵng', city: 'Đà Nẵng', stars: 4, brand: null, style: null, thumbnail: 'dev/thang/images/hotels/a.jpg', images: ['dev/thang/images/hotels/a.jpg', 'https://other.example/b.jpg'] });
    store.roomTypes.push(
      { id: 'H1--STD', propertyId: 'H1', name: 'Tiêu chuẩn', maxGuests: 2, defaultTotal: 3, defaultPrice: 1_000_000, ratePlans: plans },
      { id: 'H1--FAM', propertyId: 'H1', name: 'Gia đình', maxGuests: 4, defaultTotal: 1, defaultPrice: 2_000_000, ratePlans: plans },
    );
    await new CalendarUseCases(store, () => TODAY_DATE).openCalendarWindow(30);
    for (const key of store.roomDays.keys()) {
      const [id, date] = key.split('|') as [string, string];
      store.patchRoomDay(id, date, { isStopSell: false, isClosedToArrival: false, isClosedToDeparture: false, minLos: 1, price: id === 'H1--STD' ? 1_000_000 : 2_000_000 });
    }
    const moduleRef = await Test.createTestingModule({
      imports: [
        FakePlatformModule,
        ClsModule.forRoot({ global: true, plugins: createTransactionalPlugins([FakePlatformModule]) }),
        AuthModule.forRootAsync({
          useFactory: () => ({
            verifier: async () => {
              throw new InvalidAccessTokenError();
            },
            blocklist: new MemorySidBlocklist(),
          }),
        }),
        CommerceModule,
      ],
    })
      .overrideProvider(COMMERCE_STORE)
      .useValue(store)
      .overrideProvider(TODAY)
      .useValue(() => TODAY_DATE)
      .compile();
    app = moduleRef.createNestApplication();
    applyGlobalPrefix(app);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('mặc định ở 1 đêm từ hôm nay, 2 khách: ảnh, tỉnh, giá theo gói, còn phòng thật, lịch 14 ngày', async () => {
    const res = await request(app.getHttpServer()).get('/api/hotels/H1').expect(200);
    expect(res.body).toMatchObject({
      id: 'H1',
      name: 'Biển Xanh',
      province: { slug: 'da-nang', name: 'Đà Nẵng' },
      // Khoá trên S3 thành URL CloudFront; URL đầy đủ có sẵn thì giữ nguyên.
      thumbnail: 'https://cdn.test/dev/thang/images/hotels/a.jpg',
      images: ['https://cdn.test/dev/thang/images/hotels/a.jpg', 'https://other.example/b.jpg'],
      stay: { checkIn: TODAY_DATE, checkOut: '2026-12-02', nights: 1, adults: 2 },
      priceFrom: 1_000_000,
      isAvailable: true,
    });
    const std = res.body.rooms[0];
    expect(std).toMatchObject({ productId: 'H1--STD', roomsNeeded: 1, isAvailable: true, remaining: 3 });
    expect(std.ratePlans.map((p: { code: string; pricePerNight: number }) => [p.code, p.pricePerNight])).toEqual([['RO', 1_000_000], ['BB', 1_200_000]]);
    expect(res.body.calendar).toHaveLength(14);
    expect(res.body.calendar[0]).toEqual({ date: TODAY_DATE, priceFrom: 1_000_000, isAvailable: true });
  });

  it('kỳ ở nhiều đêm và nhóm đông: tính số phòng, tổng tiền cả kỳ; loại hết phòng báo lý do', async () => {
    store.patchRoomDay('H1--FAM', '2026-12-06', { sold: 1 });
    const res = await request(app.getHttpServer()).get('/api/hotels/H1?checkIn=2026-12-05&checkOut=2026-12-08&adults=5').expect(200);
    const [std, fam] = res.body.rooms;
    expect(std).toMatchObject({ roomsNeeded: 3, isAvailable: true });
    expect(std.ratePlans[0]).toMatchObject({ totalPrice: 9_000_000, pricePerNight: 1_000_000 });
    expect(fam).toMatchObject({ roomsNeeded: 2, isAvailable: false, reason: 'SOLD_OUT' });
    expect(fam.ratePlans[0].totalPrice).toBeNull();
  });

  it('trả thông tin trang chi tiết: địa chỉ, đánh giá, tiện ích, chính sách, chi tiết phòng, giá gạch', async () => {
    Object.assign(store.properties[0]!, {
      address: '78 Trần Phú, Nha Trang',
      lat: 12.2388,
      lng: 109.1967,
      ratingAvg: 4.9,
      reviewCount: 2200,
      ratingSource: 'tripadvisor',
      checkInTime: '15:00',
      checkOutTime: '12:00',
      details: {
        description: 'Gần biển.',
        nearby: [{ name: 'Chùa Long Sơn', distanceKm: 3.1 }],
        amenities: [{ group: 'wellness', name: 'Spa', icon: 'spa', featured: true }],
        policies: { depositAmount: 1_000_000 },
      },
    });
    store.roomTypes[0]!.details = { bedType: '1 giường siêu lớn', areaM2: 42, view: 'city', images: ['dev/thang/images/hotels/r.jpg'], amenities: ['Ghế sofa'] };
    store.roomTypes[0]!.ratePlans = [{ ...plans[0]!, discountPct: 35, perks: ['Ưu đãi 30% Spa'] }];
    const res = await request(app.getHttpServer()).get('/api/hotels/H1').expect(200);
    expect(res.body).toMatchObject({
      address: '78 Trần Phú, Nha Trang',
      location: { lat: 12.2388, lng: 109.1967 },
      rating: { average: 4.9, count: 2200, source: 'tripadvisor' },
      checkInTime: '15:00',
      description: 'Gần biển.',
      nearby: [{ name: 'Chùa Long Sơn', distanceKm: 3.1 }],
      amenities: [{ name: 'Spa', featured: true }],
      highlights: [],
      facts: { floors: null },
      policies: { depositAmount: 1_000_000, child: null },
    });
    const std = res.body.rooms[0];
    expect(std).toMatchObject({ bedType: '1 giường siêu lớn', areaM2: 42, view: 'city', images: ['https://cdn.test/dev/thang/images/hotels/r.jpg'] });
    // Giá khách trả giữ nguyên; giá gạch = 1.000.000 / 0.65, làm tròn lên 10.000đ.
    expect(std.ratePlans[0]).toMatchObject({ pricePerNight: 1_000_000, listPricePerNight: 1_540_000, discountPct: 35, perks: ['Ưu đãi 30% Spa'] });
  });

  it('khách sạn chưa có dữ liệu chi tiết thì trả null / mảng rỗng, không lỗi', async () => {
    const res = await request(app.getHttpServer()).get('/api/hotels/H1').expect(200);
    expect(res.body).toMatchObject({ address: null, location: null, rating: null, description: null, amenities: [], nearby: [] });
    expect(res.body.rooms[1]).toMatchObject({ bedType: null, images: [], amenities: [] });
    expect(res.body.rooms[0].ratePlans[0]).toMatchObject({ listPricePerNight: null, discountPct: null, perks: [] });
  });

  describe('GET /api/hotels/:id/reviews', () => {
    const review = (id: string, rating: number, createdAt: string, extra: Partial<(typeof store.reviewRows)[number]> = {}) => ({
      id,
      propertyId: 'H1',
      roomTypeId: null,
      authorName: `Khách ${id}`,
      rating,
      title: null,
      body: `Nội dung ${id}`,
      tags: [],
      images: [],
      travelerType: null,
      stayMonth: '2026-10-01',
      helpfulCount: 0,
      createdAt,
      ...extra,
    });

    beforeEach(() => {
      store.properties[0]!.details = { reviewSummary: 'Khách khen gần biển.' };
      store.reviewRows.push(
        review('R1', 5, '2026-10-20T00:00:00.000Z', { tags: ['Gần biển', 'Sạch sẽ'], roomTypeId: 'H1--STD', images: ['dev/thang/images/hotels/a.jpg'], travelerType: 'family' }),
        review('R2', 4, '2026-10-25T00:00:00.000Z', { tags: ['Gần biển'], helpfulCount: 9 }),
        review('R3', 2, '2026-10-10T00:00:00.000Z', { tags: [] }),
        review('R4', 1, '2026-10-30T00:00:00.000Z', { status: 'hidden' }),
        { ...review('X1', 5, '2026-10-30T00:00:00.000Z'), propertyId: 'H2' },
      );
    });

    it('trả thống kê, tóm tắt và trang đánh giá mới nhất trước; bỏ đánh giá đã ẩn và của khách sạn khác', async () => {
      const res = await request(app.getHttpServer()).get('/api/hotels/H1/reviews').expect(200);
      expect(res.body.summary).toEqual({
        average: 3.7,
        count: 3,
        distribution: [
          { rating: 5, count: 1 },
          { rating: 4, count: 1 },
          { rating: 3, count: 0 },
          { rating: 2, count: 1 },
          { rating: 1, count: 0 },
        ],
        tags: [
          { tag: 'Gần biển', count: 2 },
          { tag: 'Sạch sẽ', count: 1 },
        ],
        aiSummary: 'Khách khen gần biển.',
      });
      expect(res.body.items.map((r: { id: string }) => r.id)).toEqual(['R2', 'R1', 'R3']);
      expect(res.body).toMatchObject({ page: 1, limit: 10, total: 3 });
      expect(res.body.items[1]).toMatchObject({ room: { productId: 'H1--STD', name: 'Tiêu chuẩn' }, images: ['https://cdn.test/dev/thang/images/hotels/a.jpg'], travelerType: 'family' });
    });

    it('lọc theo tag, số sao; sắp theo hữu ích; phân trang', async () => {
      const byTag = await request(app.getHttpServer()).get(`/api/hotels/H1/reviews?tag=${encodeURIComponent('Gần biển')}&sort=helpful`).expect(200);
      expect(byTag.body.items.map((r: { id: string }) => r.id)).toEqual(['R2', 'R1']);
      expect(byTag.body.summary.count).toBe(3);
      const byRating = await request(app.getHttpServer()).get('/api/hotels/H1/reviews?rating=2').expect(200);
      expect(byRating.body).toMatchObject({ total: 1, items: [{ id: 'R3' }] });
      const page2 = await request(app.getHttpServer()).get('/api/hotels/H1/reviews?sort=lowest&limit=2&page=2').expect(200);
      expect(page2.body).toMatchObject({ page: 2, limit: 2, total: 3, items: [{ id: 'R1' }] });
    });

    it('khách sạn chưa có đánh giá thì thống kê rỗng; không có khách sạn 404; tham số sai 400', async () => {
      store.reviewRows.length = 0;
      store.properties[0]!.details = {};
      const empty = await request(app.getHttpServer()).get('/api/hotels/H1/reviews').expect(200);
      expect(empty.body).toMatchObject({ summary: { average: null, count: 0, tags: [], aiSummary: null }, items: [], total: 0 });
      await request(app.getHttpServer()).get('/api/hotels/KHONG-CO/reviews').expect(404);
      const bad = await request(app.getHttpServer()).get('/api/hotels/H1/reviews?rating=6').expect(400);
      expect(bad.body.errors[0].field).toBe('rating');
      await request(app.getHttpServer()).get('/api/hotels/H1/reviews?sort=random').expect(400);
    });
  });

  it('khách sạn không có thì 404; ngày sai hoặc quá khứ thì 400 kèm tên trường', async () => {
    await request(app.getHttpServer()).get('/api/hotels/KHONG-CO').expect(404);
    const past = await request(app.getHttpServer()).get('/api/hotels/H1?checkIn=2026-11-01').expect(400);
    expect(past.body.errors).toEqual([expect.objectContaining({ field: 'checkIn' })]);
    const bad = await request(app.getHttpServer()).get('/api/hotels/H1?adults=0').expect(400);
    expect(bad.body.errors[0].field).toBe('adults');
  });
});
