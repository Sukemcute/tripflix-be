import 'reflect-metadata';
import { Global, type INestApplication, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthModule, InvalidAccessTokenError, MemorySidBlocklist, type AuthUser } from '@tripflix/auth';
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

// E2E chạy app Nest thật (guard @Roles, @Transactional, kiểm body, filter lỗi); database thay bằng bản bộ nhớ.
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

const USERS: Record<string, AuthUser> = {
  'token-admin': { userId: '00000000-0000-4000-8000-000000000001', role: 'superadmin', sid: 's1', exp: 9_999_999_999 },
  'token-mod': { userId: '00000000-0000-4000-8000-000000000002', role: 'moderator', sid: 's2', exp: 9_999_999_999 },
};

const TODAY_DATE = '2026-12-01';
const plans = [{ code: 'RO', name: 'Chỉ phòng', meal: 'none', refundable: true, freeCancelDays: 3, priceFactor: 1 }];
const ADMIN = { Authorization: 'Bearer token-admin' };

describe('commerce E2E: màn Lịch trống & giá', () => {
  let app: INestApplication;
  let store: MemoryCommerceStore;

  beforeEach(async () => {
    store = new MemoryCommerceStore();
    store.properties.push({ id: 'H1', name: 'Biển Xanh', provinceSlug: 'da-nang', provinceName: 'Đà Nẵng', city: null, stars: 4, brand: null, style: null, thumbnail: null, images: [] });
    store.roomTypes.push({ id: 'H1--STD', propertyId: 'H1', name: 'Tiêu chuẩn', maxGuests: 2, defaultTotal: 5, defaultPrice: 1_000_000, ratePlans: plans });
    store.flights.push({ id: 'F1--Y', flightKey: 'F1', name: 'Bay HAN – DAD', airline: 'VN', fromAirport: 'HAN', toAirport: 'DAD', departTime: null, arriveTime: null, destinationSlug: 'da-nang', destinationName: 'Đà Nẵng', cabinName: 'Phổ thông', defaultSeats: 10, defaultPrice: 1_500_000, farePlans: plans });
    await new CalendarUseCases(store, () => TODAY_DATE).openCalendarWindow(30);

    const moduleRef = await Test.createTestingModule({
      imports: [
        FakePlatformModule,
        ClsModule.forRoot({ global: true, plugins: createTransactionalPlugins([FakePlatformModule]) }),
        AuthModule.forRootAsync({
          useFactory: () => ({
            verifier: async (token: string) => {
              const user = USERS[token];
              if (!user) throw new InvalidAccessTokenError();
              return user;
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

  const roomUrl = '/api/admin/commerce/room-types/H1--STD/calendar';

  it('chỉ superadmin: không token 401, moderator 403', async () => {
    await request(app.getHttpServer()).get(`${roomUrl}?from=2026-12-01&to=2026-12-03`).expect(401);
    await request(app.getHttpServer()).get(`${roomUrl}?from=2026-12-01&to=2026-12-03`).set({ Authorization: 'Bearer token-mod' }).expect(403);
  });

  it('sửa giá, số phòng, luật bán cả khoảng ngày; xem lại thấy giá mới; ghi audit_logs', async () => {
    const res = await request(app.getHttpServer())
      .patch(roomUrl)
      .set(ADMIN)
      .send({ from: '2026-12-05', to: '2026-12-07', price: 1_500_000, total: 8, isClosedToArrival: true })
      .expect(200);
    expect(res.body).toEqual({ updatedDays: 3 });

    const days = (await request(app.getHttpServer()).get(`${roomUrl}?from=2026-12-04&to=2026-12-08`).set(ADMIN).expect(200)).body;
    expect(days.map((d: { date: string; price: number; total: number }) => [d.date, d.price, d.total])).toEqual([
      ['2026-12-04', expect.any(Number), 5],
      ['2026-12-05', 1_500_000, 8],
      ['2026-12-06', 1_500_000, 8],
      ['2026-12-07', 1_500_000, 8],
      ['2026-12-08', expect.any(Number), 5],
    ]);
    expect(days[1]).toMatchObject({ isClosedToArrival: true, remaining: 8 });
    expect(store.auditLogs).toEqual([
      expect.objectContaining({ actorUserId: USERS['token-admin']!.userId, action: 'room_calendar.updated', entityId: 'H1--STD', changes: expect.objectContaining({ from: '2026-12-05', price: 1_500_000 }) }),
    ]);
  });

  it('không cho giảm số phòng dưới held + sold: 409 kèm ngày vi phạm, không ngày nào bị đổi, không ghi audit', async () => {
    store.patchRoomDay('H1--STD', '2026-12-06', { held: 1, sold: 2 });
    const res = await request(app.getHttpServer()).patch(roomUrl).set(ADMIN).send({ from: '2026-12-05', to: '2026-12-07', total: 2 }).expect(409);
    expect(res.body.dates).toEqual(['2026-12-06']);
    expect(store.auditLogs).toHaveLength(0);
  });

  it('khoảng có ngày chưa mở bán thì 409; body sai thì 400; mã lạ thì 404', async () => {
    await request(app.getHttpServer()).patch(roomUrl).set(ADMIN).send({ from: '2027-12-01', to: '2027-12-02', price: 1_000_000 }).expect(409);
    await request(app.getHttpServer()).patch(roomUrl).set(ADMIN).send({ from: '2026-12-05', to: '2026-12-06', price: -1 }).expect(400);
    await request(app.getHttpServer()).patch(roomUrl).set(ADMIN).send({ from: '2026-12-05', to: '2026-12-06', role: 'x' }).expect(400);
    await request(app.getHttpServer()).patch(roomUrl).set(ADMIN).send({ from: '2026-12-05', to: '2026-12-06' }).expect(400);
    await request(app.getHttpServer()).patch('/api/admin/commerce/room-types/KHONG/calendar').set(ADMIN).send({ from: '2026-12-05', to: '2026-12-06', price: 1_000_000 }).expect(404);
  });

  it('chuyến bay: sửa giá và số ghế', async () => {
    await request(app.getHttpServer()).patch('/api/admin/commerce/flights/F1--Y/calendar').set(ADMIN).send({ from: '2026-12-10', to: '2026-12-10', price: 2_000_000, total: 12 }).expect(200);
    const [day] = (await request(app.getHttpServer()).get('/api/admin/commerce/flights/F1--Y/calendar?from=2026-12-10&to=2026-12-10').set(ADMIN).expect(200)).body;
    expect(day).toMatchObject({ price: 2_000_000, total: 12, remaining: 12 });
  });
});
