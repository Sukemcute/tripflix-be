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
    { provide: CORE_ENV, useValue: { NODE_ENV: 'test', APP_ROLE: 'api' } as CoreEnv },
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
    store.properties.push({ id: 'H1', name: 'Biển Xanh', provinceSlug: 'da-nang', provinceName: 'Đà Nẵng', city: 'Đà Nẵng', stars: 4, brand: null, style: null, thumbnail: '/img/a.jpg', images: ['/img/a.jpg', '/img/b.jpg'] });
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
      images: ['/img/a.jpg', '/img/b.jpg'],
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

  it('khách sạn không có thì 404; ngày sai hoặc quá khứ thì 400 kèm tên trường', async () => {
    await request(app.getHttpServer()).get('/api/hotels/KHONG-CO').expect(404);
    const past = await request(app.getHttpServer()).get('/api/hotels/H1?checkIn=2026-11-01').expect(400);
    expect(past.body.errors).toEqual([expect.objectContaining({ field: 'checkIn' })]);
    const bad = await request(app.getHttpServer()).get('/api/hotels/H1?adults=0').expect(400);
    expect(bad.body.errors[0].field).toBe('adults');
  });
});
