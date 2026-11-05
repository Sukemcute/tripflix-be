import 'reflect-metadata';
import { fileURLToPath } from 'node:url';
import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { buildDrizzleToken, createDb, createPool, createTransactionalPlugins, MODULES, type Db } from '@tripflix/db';
import { migrateModule, startPostgres, type PostgresFixture } from '@tripflix/testing';
import { ClsModule } from 'nestjs-cls';
import type pg from 'pg';
import { CalendarAdminUseCases } from '../application/calendar-admin.use-cases.js';
import { CalendarUseCases } from '../application/calendar.use-cases.js';
import { CatalogUseCases } from '../application/catalog.use-cases.js';
import { COMMERCE_STORE } from '../application/ports.js';
import { CommerceError } from '../domain/errors.js';
import { seedCatalog } from '../../db/seed/seed-catalog.js';
import { DrizzleCommerceStore } from './drizzle-commerce.store.js';

// Câu query Drizzle, CHECK chống bán quá và rollback của @Transactional('commerce') trên Postgres thật (user tf_commerce).
const TODAY = '2026-12-01';
const ACTOR = '00000000-0000-4000-8000-000000000001';

describe('DrizzleCommerceStore trên Postgres thật', () => {
  let postgres: PostgresFixture;
  let pool: pg.Pool;
  let db: Db;
  let catalog: CatalogUseCases;
  let admin: CalendarAdminUseCases;
  let roomTypeId: string;

  beforeAll(async () => {
    postgres = await startPostgres();
    const url = postgres.buildModuleUrl('commerce');
    await migrateModule({ url, module: 'commerce', migrationsFolder: fileURLToPath(new URL('../../db/migrations', import.meta.url)) });
    pool = createPool({ url, max: 5, applicationName: 'commerce-int-test' });
    db = createDb(pool);
    await seedCatalog(db, fileURLToPath(new URL('../../db/seed/catalog.json', import.meta.url)));
    await new CalendarUseCases(new DrizzleCommerceStore({ tx: db }), () => TODAY).openCalendarWindow(30);

    @Global()
    @Module({ providers: MODULES.map((m) => ({ provide: buildDrizzleToken(m), useValue: db })), exports: MODULES.map((m) => buildDrizzleToken(m)) })
    class DrizzleModule {}
    const moduleRef = await Test.createTestingModule({
      imports: [DrizzleModule, ClsModule.forRoot({ global: true, plugins: createTransactionalPlugins([DrizzleModule]) })],
      providers: [{ provide: COMMERCE_STORE, useClass: DrizzleCommerceStore }, CalendarAdminUseCases],
    }).compile();
    await moduleRef.init();
    admin = moduleRef.get(CalendarAdminUseCases);
    const store = moduleRef.get<DrizzleCommerceStore>(COMMERCE_STORE);
    catalog = new CatalogUseCases(store, () => TODAY);
    roomTypeId = (await pool.query<{ id: string }>('select id from commerce.room_types order by id limit 1')).rows[0]!.id;
  });

  afterAll(async () => {
    await pool?.end();
    await postgres?.stop();
  });

  it('mở lịch: mỗi ngày phòng có đúng một dòng giá; chạy lại không chèn thêm', async () => {
    const { rows } = await pool.query<{ inventory: number; rates: number }>(
      'select (select count(*) from commerce.room_inventory)::int as inventory, (select count(*) from commerce.room_rates)::int as rates',
    );
    expect(rows[0]!.inventory).toBeGreaterThan(0);
    expect(rows[0]!.rates).toBe(rows[0]!.inventory);
    expect(await new CalendarUseCases(new DrizzleCommerceStore({ tx: db }), () => TODAY).openCalendarWindow(30)).toEqual({ roomDays: 0, flightDays: 0 });
  });

  it('listCatalog phân trang hết không trùng; checkAvailability đọc được lịch thật', async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await catalog.listCatalog({ limit: 100, cursor });
      seen.push(...page.items.map((i) => i.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(new Set(seen).size).toBe(seen.length);
    const [result] = await catalog.checkAvailability({ productIds: [roomTypeId], checkIn: '2026-12-10', checkOut: '2026-12-11', adults: 1 });
    expect(result!.isFound).toBe(true);
  });

  it('CHECK của database chặn bán quá kể cả khi code sai', async () => {
    await expect(pool.query(`update commerce.room_inventory set sold = total + 1 where room_type_id = $1 and date = $2`, [roomTypeId, '2026-12-05'])).rejects.toThrow(/ck_room_inventory_not_oversold/);
  });

  it('sửa giá trong transaction: ghi lịch + audit_logs; checkAvailability thấy giá mới', async () => {
    await admin.updateRoomCalendar(ACTOR, roomTypeId, { from: '2026-12-10', to: '2026-12-12' }, { price: 3_330_000, isStopSell: false, isClosedToArrival: false, isClosedToDeparture: false, minLos: 1 });
    const { rows } = await pool.query('select price from commerce.room_rates where room_type_id = $1 and date between $2 and $3', [roomTypeId, '2026-12-10', '2026-12-12']);
    expect(rows.map((r) => Number(r.price))).toEqual([3_330_000, 3_330_000, 3_330_000]);
    const audit = await pool.query('select action, entity_id from commerce.audit_logs where entity_id = $1', [roomTypeId]);
    expect(audit.rows).toEqual([{ action: 'room_calendar.updated', entity_id: roomTypeId }]);
    const [result] = await catalog.checkAvailability({ productIds: [roomTypeId], checkIn: '2026-12-10', checkOut: '2026-12-11', adults: 1 });
    expect(result!.unitPrice).toBe(3_330_000);
  });

  it('đánh giá: seed nạp dữ liệu demo; thống kê, lọc tag (jsonb), sắp xếp, phân trang chạy đúng trên Postgres', async () => {
    const store = new DrizzleCommerceStore({ tx: db });
    const { rows } = await pool.query<{ id: string; n: number; avg: number }>(
      'select property_id as id, count(*)::int as n, avg(rating)::float8 as avg from commerce.reviews where is_seeded group by property_id order by n desc limit 1',
    );
    const hotel = rows[0]!;
    const stats = await store.reviews.getReviewStats(hotel.id, 3);
    expect(stats.count).toBe(hotel.n);
    expect(stats.average).toBeCloseTo(hotel.avg, 6);
    expect(stats.distribution.reduce((a, b) => a + b, 0)).toBe(hotel.n);
    expect(stats.tags.length).toBeLessThanOrEqual(3);
    const topTag = stats.tags[0]!;
    const byTag = await store.reviews.listReviews({ propertyId: hotel.id, tag: topTag.tag, sort: 'highest', offset: 0, limit: 50 });
    expect(byTag.total).toBe(topTag.count);
    expect(byTag.items.every((r) => r.tags.includes(topTag.tag))).toBe(true);
    expect(byTag.items.map((r) => r.rating)).toEqual(byTag.items.map((r) => r.rating).sort((a, b) => b - a));
    const page2 = await store.reviews.listReviews({ propertyId: hotel.id, sort: 'newest', offset: 5, limit: 5 });
    expect(page2).toMatchObject({ total: hotel.n });
    expect(page2.items).toHaveLength(5);

    await pool.query(`update commerce.reviews set status = 'hidden' where id = $1`, [page2.items[0]!.id]);
    expect((await store.reviews.getReviewStats(hotel.id, 3)).count).toBe(hotel.n - 1);
  });

  it('giảm số phòng dưới held + sold ở một ngày: rollback cả khoảng, giá cũng không đổi, không ghi audit', async () => {
    await pool.query('update commerce.room_inventory set sold = 2 where room_type_id = $1 and date = $2', [roomTypeId, '2026-12-21']);
    const before = await pool.query('select date::text, total from commerce.room_inventory where room_type_id = $1 and date between $2 and $3 order by date', [roomTypeId, '2026-12-20', '2026-12-22']);
    const auditBefore = (await pool.query('select count(*)::int as n from commerce.audit_logs')).rows[0].n;

    const error = await admin.updateRoomCalendar(ACTOR, roomTypeId, { from: '2026-12-20', to: '2026-12-22' }, { total: 1, price: 9_990_000 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CommerceError);
    expect((error as CommerceError).details).toEqual({ dates: ['2026-12-21'] });

    const after = await pool.query('select date::text, total from commerce.room_inventory where room_type_id = $1 and date between $2 and $3 order by date', [roomTypeId, '2026-12-20', '2026-12-22']);
    expect(after.rows).toEqual(before.rows);
    const prices = await pool.query('select count(*)::int as n from commerce.room_rates where room_type_id = $1 and price = 9990000', [roomTypeId]);
    expect(prices.rows[0].n).toBe(0);
    expect((await pool.query('select count(*)::int as n from commerce.audit_logs')).rows[0].n).toBe(auditBefore);
  });
});
