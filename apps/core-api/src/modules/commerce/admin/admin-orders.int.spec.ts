import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createDb, createPool, type Db } from '@tripflix/db';
import { migrateModule, startPostgres, type PostgresFixture } from '@tripflix/testing';
import type pg from 'pg';
import { seedCatalog } from '../db/seed/seed-catalog.js';
import { AdminOrdersStore } from './admin-orders.store.js';
import type { AnomalyKind } from './anomaly-kinds.js';

// TF43 trên Postgres thật: dựng thẳng các tình huống lỗi vào bảng (đường nghiệp vụ đã chặn nên không tạo được qua API),
// rồi kiểm từng loại bất thường bắt đúng đơn và không báo nhầm đơn bình thường.
const NOW = new Date('2026-11-19T10:00:00Z');
const OLD = '2026-11-19T08:00:00Z';
const DATE = '2026-12-10';

describe('TF43 đơn bất thường cho quản trị', () => {
  let postgres: PostgresFixture;
  let pool: pg.Pool;
  let db: Db;
  let store: AdminOrdersStore;
  let roomTypeId: string;

  async function createOrder(input: { status: string; total?: number; paid?: boolean; code?: string | null; itemCode?: string | null; phone?: string; createdAt?: string }) {
    const id = randomUUID();
    const total = input.total ?? 2_000_000;
    await pool.query(
      `insert into commerce.orders (id, user_id, status, total, adults, hold_expires_at, confirmation_code, contact_phone, contact_email, paid_at, created_at)
       values ($1, $2, $3, $4, 2, $5, $6, $7, $8, $9, $10)`,
      [id, randomUUID(), input.status, total, OLD, input.code ?? null, input.phone ?? null, 'Khach@Example.com', input.paid ? OLD : null, input.createdAt ?? OLD],
    );
    await pool.query(
      `insert into commerce.order_items (order_id, product_type, product_id, product_name, date, nights, qty, unit_price, line_total, rate_plan_code, rate_plan_name, is_refundable, confirmation_code)
       values ($1, 'room', $2, 'Phòng thử', $3, 1, 1, $4, $4, 'RO', 'Chỉ phòng', true, $5)`,
      [id, roomTypeId, DATE, total, input.itemCode === undefined ? 'ITEM1' : input.itemCode],
    );
    return id;
  }
  async function addPayment(orderId: string, input: { status: string; amount?: number; gatewayPaidAt?: string; needsReview?: boolean; createdAt?: string }) {
    const id = randomUUID();
    await pool.query(
      `insert into commerce.payments (id, order_id, user_id, gateway_key, amount, status, gateway, gateway_paid_at, needs_review, created_at)
       values ($1, $2, $3, $4, $5, $6, 'mock', $7, $8, $9)`,
      [id, orderId, randomUUID(), `charge:${id}`, input.amount ?? 2_000_000, input.status, input.gatewayPaidAt ?? null, input.needsReview ?? false, input.createdAt ?? OLD],
    );
    return id;
  }
  const kindsOf = async (orderId: string) => (await store.findAnomalies({ orderId, limitPerKind: 10, now: NOW })).map((a) => a.kind).sort();
  const setSold = (sold: number) => pool.query('update commerce.room_inventory set sold = $1 where room_type_id = $2 and date = $3', [sold, roomTypeId, DATE]);

  beforeAll(async () => {
    postgres = await startPostgres();
    const url = postgres.buildModuleUrl('commerce');
    await migrateModule({ url, module: 'commerce', migrationsFolder: fileURLToPath(new URL('../db/migrations', import.meta.url)) });
    pool = createPool({ url, max: 5, applicationName: 'commerce-admin-int' });
    db = createDb(pool);
    await seedCatalog(db, fileURLToPath(new URL('../db/seed/catalog.json', import.meta.url)), undefined, { shouldIncludeHotel: (id) => !id.startsWith('P-osm-') });
    roomTypeId = (await pool.query<{ id: string }>('select id from commerce.room_types order by id limit 1')).rows[0]!.id;
    await pool.query(`insert into commerce.room_inventory (room_type_id, date, total, sold) values ($1, $2, 10, 0) on conflict (room_type_id, date) do update set sold = 0`, [roomTypeId, DATE]);
    store = new AdminOrdersStore({ tx: db });
  });

  afterAll(async () => {
    pool?.on('error', (error: Error & { code?: string }) => {
      if (error.code !== '57P01') throw error;
    });
    await pool?.end();
    await postgres?.stop();
  });

  beforeEach(async () => {
    await pool.query('truncate commerce.refunds, commerce.payments, commerce.order_items, commerce.order_status_history, commerce.order_guests, commerce.orders cascade');
    await setSold(0);
  });

  it('đơn paid bình thường không bị báo', async () => {
    const id = await createOrder({ status: 'paid', paid: true, code: 'OKAY0001' });
    await addPayment(id, { status: 'succeeded' });
    await setSold(1);
    expect(await kindsOf(id)).toEqual([]);
  });

  it('trừ hai lần: khoản failed nhưng cổng vẫn có giờ trả; hoàn xong một khoản thì hết báo', async () => {
    const id = await createOrder({ status: 'paid', paid: true, code: 'DOUB0001' });
    await addPayment(id, { status: 'succeeded' });
    const lost = await addPayment(id, { status: 'failed', gatewayPaidAt: OLD });
    await setSold(1);
    const [anomaly] = await store.findAnomalies({ kinds: ['double_charge'], limitPerKind: 10, now: NOW });
    expect(anomaly).toMatchObject({ kind: 'double_charge', orderId: id, confirmationCode: 'DOUB0001', detail: { charges: 2, chargedAmount: 4_000_000 } });

    await pool.query(`insert into commerce.refunds (order_id, payment_id, gateway_key, amount, reason, status) values ($1, $2, 'refund:x', 2000000, 'duplicate', 'succeeded')`, [id, lost]);
    expect(await kindsOf(id)).toEqual([]);
  });

  it('đã trừ tiền mà đơn hết hạn: báo sau 10 phút, chưa đủ 10 phút thì chưa báo', async () => {
    const expired = await createOrder({ status: 'expired' });
    await addPayment(expired, { status: 'succeeded' });
    expect(await kindsOf(expired)).toEqual<AnomalyKind[]>(['charged_without_seat']);

    const fresh = await createOrder({ status: 'paying' });
    await addPayment(fresh, { status: 'succeeded', createdAt: new Date(NOW.getTime() - 60_000).toISOString() });
    expect(await kindsOf(fresh)).toEqual([]);
  });

  it('đơn paid mà kho không ghi bán, hoặc mục thiếu mã xác nhận', async () => {
    const noSeat = await createOrder({ status: 'paid', paid: true, code: 'SEAT0001' });
    await addPayment(noSeat, { status: 'succeeded' });
    const [anomaly] = await store.findAnomalies({ kinds: ['paid_without_seat'], limitPerKind: 10, now: NOW });
    expect(anomaly).toMatchObject({ orderId: noSeat, detail: { shortCells: [{ productId: roomTypeId, date: DATE, sold: 0, expectedSold: 1 }], itemsWithoutCode: 0 } });

    await setSold(1);
    expect(await kindsOf(noSeat)).toEqual([]);
    const noCode = await createOrder({ status: 'paid', paid: true, code: 'SEAT0002', itemCode: null });
    await addPayment(noCode, { status: 'succeeded' });
    // Hai đơn paid cùng ô mà kho chỉ ghi 1: cả hai đều thiếu chỗ.
    expect(await kindsOf(noCode)).toEqual<AnomalyKind[]>(['paid_without_seat']);
    expect(await kindsOf(noSeat)).toEqual<AnomalyKind[]>(['paid_without_seat']);
  });

  it('đơn paid không có khoản trừ, hoặc trừ lệch tổng đơn', async () => {
    await setSold(2);
    const none = await createOrder({ status: 'paid', paid: true, code: 'AMNT0001' });
    const wrong = await createOrder({ status: 'paid', paid: true, code: 'AMNT0002' });
    await addPayment(wrong, { status: 'succeeded', amount: 1_500_000 });
    const items = await store.findAnomalies({ kinds: ['paid_amount_mismatch'], limitPerKind: 10, now: NOW });
    expect(items.map((a) => [a.orderId, a.detail['chargedAmount']]).sort()).toEqual([[none, 0], [wrong, 1_500_000]].sort());
  });

  it('khoản trừ kẹt quá 30 phút hoặc chuyển người xử lý; khoản hoàn cần xem', async () => {
    const stuck = await createOrder({ status: 'paying' });
    await addPayment(stuck, { status: 'initiated' });
    const review = await createOrder({ status: 'cancelled' });
    const paymentId = await addPayment(review, { status: 'failed', needsReview: true, createdAt: NOW.toISOString() });
    await pool.query(`insert into commerce.refunds (order_id, payment_id, gateway_key, amount, reason, needs_review) values ($1, $2, 'refund:y', 2000000, 'cancel', true)`, [review, paymentId]);

    expect(await kindsOf(stuck)).toEqual<AnomalyKind[]>(['stuck_payment']);
    expect(await kindsOf(review)).toEqual<AnomalyKind[]>(['refund_needs_review', 'stuck_payment']);
  });

  it('tra đơn theo mã xác nhận, điện thoại, email, mã đơn; lọc trạng thái và phân trang', async () => {
    const a = await createOrder({ status: 'paid', paid: true, code: 'FIND0001', phone: '0901111111', createdAt: '2026-11-18T01:00:00Z' });
    const b = await createOrder({ status: 'expired', phone: '0902222222', createdAt: '2026-11-18T02:00:00Z' });
    await addPayment(a, { status: 'succeeded' });

    expect((await store.search({ q: 'find0001', limit: 10 })).map((o) => o.id)).toEqual([a]);
    expect((await store.search({ q: '0902222222', limit: 10 })).map((o) => o.id)).toEqual([b]);
    expect((await store.search({ q: 'khach@example.com', limit: 10 })).map((o) => o.id)).toEqual([b, a]);
    expect((await store.search({ q: a, limit: 10 })).map((o) => o.id)).toEqual([a]);
    expect((await store.search({ statuses: ['expired'], limit: 10 })).map((o) => o.id)).toEqual([b]);
    const page1 = await store.search({ limit: 1 });
    expect((await store.search({ before: page1[0]!.createdAt, limit: 1 })).map((o) => o.id)).toEqual([a]);

    const detail = await store.detail(a);
    expect(detail).toMatchObject({ order: { id: a, total: 2_000_000 }, items: [{ productId: roomTypeId, confirmationCode: 'ITEM1' }], payments: [{ status: 'succeeded', amount: 2_000_000 }] });
    expect(detail!.history.length).toBeGreaterThan(0);
    expect(await store.detail(randomUUID())).toBeNull();
  });

  it('danh sách phòng và chuyến bay cho màn Lịch trống, tìm theo tên hoặc sân bay', async () => {
    const rooms = await store.searchProducts({ kind: 'room', limit: 5 });
    expect(rooms).toHaveLength(5);
    expect(rooms[0]).toEqual({ id: expect.any(String), name: expect.any(String), parentName: expect.any(String), place: expect.any(String) });
    const hotel = rooms[0]!.parentName;
    expect((await store.searchProducts({ kind: 'room', q: hotel.toUpperCase(), limit: 50 })).every((r) => r.parentName === hotel)).toBe(true);

    const [flight] = await store.searchProducts({ kind: 'flight', limit: 1 });
    const [from, to] = flight!.place.split(' → ');
    const found = await store.searchProducts({ kind: 'flight', q: `${from}-${to}`, limit: 100 });
    expect(found.map((f) => f.id)).toContain(flight!.id);
    expect(await store.searchProducts({ kind: 'room', q: 'khong-co-ten-nay', limit: 5 })).toEqual([]);
  });
});
