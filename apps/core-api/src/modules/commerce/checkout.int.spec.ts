import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Global, type INestApplication, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthModule, InvalidAccessTokenError, MemorySidBlocklist, type AuthUser } from '@tripflix/auth';
import { MODULES, buildDrizzleToken, createDb, createPool, createTransactionalPlugins, type Db } from '@tripflix/db';
import { migrateModule, startPostgres, type PostgresFixture } from '@tripflix/testing';
import { ClsModule } from 'nestjs-cls';
import type pg from 'pg';
import request from 'supertest';
import type { CoreEnv } from '../../platform/env.js';
import { applyGlobalPrefix } from '../../platform/http.js';
import { CORE_ENV, DB_POOLS, REDIS } from '../../platform/tokens.js';
import { CommerceFacade } from './commerce.facade.js';
import { CommerceModule } from './commerce.module.js';
import { seedCatalog } from './db/seed/seed-catalog.js';
import { CalendarUseCases } from './inventory/application/calendar.use-cases.js';
import { TODAY } from './inventory/application/ports.js';
import { DrizzleCommerceStore } from './inventory/infra/drizzle-commerce.store.js';
import type { ChargeResult } from './payment/application/gateway.port.js';
import { PAYMENT_GATEWAY } from './payment/application/gateway.port.js';
import { PaymentUseCases } from './payment/application/payment.use-cases.js';
import { MockGateway } from './payment/infra/mock-gateway.js';
import { VNPAY_CONFIG } from './payment/application/vnpay.use-cases.js';
import { buildSignData } from './payment/domain/vnpay-signature.js';
import { createHmac } from 'node:crypto';

// TF29 trên Postgres thật (user tf_commerce), qua HTTP: giữ chỗ, trả tiền, trả trùng, thẻ từ chối, mất phản hồi,
// cổng sập, bù tiền, tranh phòng cuối, 3DS, giá đổi. Cổng là MockGateway bọc thêm chế độ hỏng để giả lập sự cố.
const TODAY_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const POLICY = '2026-11-03';
const VISA = '4242424242424242';
const DECLINED = '4000000000000002';
const THREE_DS = '4000002500003155';

// Khoá ký giả cho test: ký callback như VNPay để kiểm IPN mà không cần mạng. Không phải khoá thật.
const VNPAY_TEST_CONFIG = { tmnCode: 'TESTTMN1', hashSecret: 'TEST_SECRET_FOR_SIGNING', paymentUrl: 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html', returnUrl: 'http://localhost/return' };
const signVnpay = (params: Record<string, string>) => ({
  ...params,
  vnp_SecureHash: createHmac('sha512', VNPAY_TEST_CONFIG.hashSecret).update(buildSignData(params)).digest('hex'),
});

/** Cổng có thể hỏng theo kịch bản: lost = trừ xong mà mất phản hồi; down = sập trước khi trừ. */
class FlakyGateway extends MockGateway {
  mode: 'ok' | 'lost' | 'down' = 'ok';
  override async charge(input: { amount: number; token: string; gatewayKey: string }): Promise<ChargeResult> {
    if (this.mode === 'down') throw new Error('gateway down');
    const result = await super.charge(input);
    if (this.mode === 'lost') throw new Error('response lost');
    return result;
  }
}

describe('TF29 checkout + thanh toán trên Postgres thật', () => {
  let postgres: PostgresFixture;
  let pool: pg.Pool;
  let db: Db;
  let app: INestApplication;
  let gateway: FlakyGateway;
  let payment: PaymentUseCases;
  let facade: CommerceFacade;
  let roomTypeId: string;
  let roomPropertyName: string;
  let flightId: string;
  const users = new Map<string, AuthUser>();

  const newUser = () => {
    const token = `token-${randomUUID()}`;
    users.set(token, { userId: randomUUID(), role: 'member', sid: randomUUID(), exp: 9_999_999_999 });
    return { auth: { Authorization: `Bearer ${token}` }, userId: users.get(token)!.userId };
  };
  const http = () => request(app.getHttpServer());
  const key = () => ({ 'Idempotency-Key': randomUUID() });

  async function holdRoom(user: { auth: Record<string, string> }, checkIn = addDays(TODAY_DATE, 20), nights = 2) {
    const res = await http()
      .post('/api/checkout')
      .set({ ...user.auth, ...key() })
      .send({ adults: 2, items: [{ productId: roomTypeId, checkIn, checkOut: addDays(checkIn, nights), qty: 1 }] });
    return res;
  }
  async function ready(user: { auth: Record<string, string> }, checkIn?: string) {
    const held = await holdRoom(user, checkIn);
    expect(held.status, JSON.stringify(held.body)).toBe(201);
    const guests = await http().put(`/api/checkout/${held.body.orderId}/guests`).set(user.auth).send({ contact: { fullName: 'Khách Thử', phone: '0901234567' }, guests: [] });
    expect(guests.status, JSON.stringify(guests.body)).toBe(200);
    return held.body as { orderId: string; total: number; items: { date: string; nights: number }[] };
  }
  const token = async (card = VISA) => (await http().post('/api/mock-gateway/tokens').send({ cardNumber: card }).expect(200)).body.paymentToken as string;
  const pay = async (user: { auth: Record<string, string> }, order: { orderId: string; total: number }, card = VISA, headers = key()) => {
    // Lấy token trước khi tạo request: supertest mở server tạm theo từng request.
    const paymentToken = await token(card);
    return http()
      .post(`/api/checkout/${order.orderId}/pay`)
      .set({ ...user.auth, ...headers })
      .send({ paymentToken, expectedTotal: order.total, acceptedPolicyVersion: POLICY });
  };
  const inventoryOf = async (date: string) =>
    (await pool.query<{ total: number; held: number; sold: number }>('select total, held, sold from commerce.room_inventory where room_type_id = $1 and date = $2', [roomTypeId, date])).rows[0]!;
  const orderStatus = async (id: string) => (await pool.query<{ status: string }>('select status from commerce.orders where id = $1', [id])).rows[0]!.status;
  const chargesAtGateway = async (orderId: string) =>
    Number((await pool.query(`select count(*) as n from commerce.mock_gateway_ops where op = 'charge' and status = 'succeeded' and gateway_key like $1`, [`charge:${orderId}:%`])).rows[0].n);

  beforeAll(async () => {
    postgres = await startPostgres();
    const url = postgres.buildModuleUrl('commerce');
    await migrateModule({ url, module: 'commerce', migrationsFolder: fileURLToPath(new URL('./db/migrations', import.meta.url)) });
    pool = createPool({ url, max: 20, applicationName: 'commerce-checkout-int' });
    db = createDb(pool);
    await seedCatalog(db, fileURLToPath(new URL('./db/seed/catalog.json', import.meta.url)));
    await new CalendarUseCases(new DrizzleCommerceStore({ tx: db }), () => TODAY_DATE).openCalendarWindow(40);
    // Bỏ ngẫu nhiên của bộ sinh lịch: mọi ngày mở bán bình thường, đủ chỗ.
    await pool.query('update commerce.room_inventory set stop_sell = false, cta = false, ctd = false, min_los = 1, total = 10');
    await pool.query('update commerce.flight_inventory set stop_sell = false, total = 10');
    roomTypeId = (await pool.query<{ id: string }>('select id from commerce.room_types where max_guests >= 2 order by id limit 1')).rows[0]!.id;
    roomPropertyName = (
      await pool.query<{ name: string }>('select p.name from commerce.room_types r join commerce.properties p on p.id = r.property_id where r.id = $1', [roomTypeId])
    ).rows[0]!.name;
    flightId = (await pool.query<{ id: string }>('select id from commerce.flights order by id limit 1')).rows[0]!.id;

    gateway = new FlakyGateway(db);
    @Global()
    @Module({
      providers: [
        { provide: CORE_ENV, useValue: { NODE_ENV: 'test', APP_ROLE: 'api' } as CoreEnv },
        { provide: DB_POOLS, useValue: { commerce: pool } },
        { provide: REDIS, useValue: {} },
        ...MODULES.map((m) => ({ provide: buildDrizzleToken(m), useValue: db })),
      ],
      exports: [CORE_ENV, DB_POOLS, REDIS, ...MODULES.map((m) => buildDrizzleToken(m))],
    })
    class TestPlatformModule {}
    const moduleRef = await Test.createTestingModule({
      imports: [
        TestPlatformModule,
        ClsModule.forRoot({ global: true, plugins: createTransactionalPlugins([TestPlatformModule]) }),
        AuthModule.forRootAsync({
          useFactory: () => ({
            verifier: async (t: string) => {
              const user = users.get(t);
              if (!user) throw new InvalidAccessTokenError();
              return user;
            },
            blocklist: new MemorySidBlocklist(),
          }),
        }),
        CommerceModule,
      ],
    })
      .overrideProvider(PAYMENT_GATEWAY)
      .useValue(gateway)
      .overrideProvider(TODAY)
      .useValue(() => TODAY_DATE)
      .overrideProvider(VNPAY_CONFIG)
      .useValue(VNPAY_TEST_CONFIG)
      .compile();
    app = moduleRef.createNestApplication();
    applyGlobalPrefix(app);
    await app.init();
    payment = moduleRef.get(PaymentUseCases);
    facade = moduleRef.get(CommerceFacade);
  });

  afterAll(async () => {
    await app?.close();
    // Dừng container có thể cắt kết nối đang đóng dở (57P01); không bắt thì Vitest báo lỗi dù test đã pass.
    pool?.on('error', (error: Error & { code?: string }) => {
      if (error.code !== '57P01') throw error;
    });
    await pool?.end();
    await postgres?.stop();
  });

  beforeEach(() => {
    gateway.mode = 'ok';
  });

  it('đầu cuối: giữ chỗ → thông tin khách → trả tiền; held → sold; mã xác nhận; sự kiện commerce.order.paid trong outbox', async () => {
    const user = newUser();
    const checkIn = addDays(TODAY_DATE, 10);
    const before = await inventoryOf(checkIn);
    const order = await ready(user, checkIn);
    expect((await inventoryOf(checkIn)).held).toBe(before.held + 1);

    const res = await pay(user, order);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ outcome: 'paid', confirmationCode: expect.stringMatching(/^TF-[A-Z2-9]{6}$/) });
    expect(await inventoryOf(checkIn)).toMatchObject({ held: before.held, sold: before.sold + 1 });
    const events = await pool.query(`select type, payload from commerce.outbox_events where type = 'commerce.order.paid' and payload->>'orderId' = $1`, [order.orderId]);
    expect(events.rows).toHaveLength(1);
    expect(events.rows[0].payload).toMatchObject({ orderId: order.orderId, userId: user.userId, total: order.total, confirmationCode: res.body.confirmationCode, contactName: 'Khách Thử', contactEmail: null });
  });

  it('bấm trả 5 lần cùng lúc cùng Idempotency-Key: đúng 1 khoản trừ ở cổng; gửi lại nhận đúng kết quả cũ', async () => {
    const user = newUser();
    const order = await ready(user);
    const paymentToken = await token();
    const headers = key();
    const send = () => http().post(`/api/checkout/${order.orderId}/pay`).set({ ...user.auth, ...headers }).send({ paymentToken, expectedTotal: order.total, acceptedPolicyVersion: POLICY });
    const results = await Promise.all(Array.from({ length: 5 }, send));
    expect(results.filter((r) => r.status === 200)).not.toHaveLength(0);
    expect(results.every((r) => [200, 409].includes(r.status))).toBe(true);
    const replay = await send();
    expect(replay.status).toBe(200);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(await chargesAtGateway(order.orderId)).toBe(1);
  });

  it('thẻ bị từ chối: 402, chỗ vẫn giữ, đơn về pending; đổi thẻ trả được, khoá cổng mới', async () => {
    const user = newUser();
    const order = await ready(user);
    const declined = await pay(user, order, DECLINED);
    expect(declined.status).toBe(402);
    expect(declined.body.declineCode).toBe('card_declined');
    expect(await orderStatus(order.orderId)).toBe('pending');
    const ok = await pay(user, order, VISA);
    expect(ok.body.outcome).toBe('paid');
    const keys = (await pool.query('select gateway_key, status from commerce.payments where order_id = $1 order by created_at', [order.orderId])).rows;
    expect(keys.map((k) => k.status)).toEqual(['failed', 'succeeded']);
    expect(keys[0].gateway_key).not.toBe(keys[1].gateway_key);
  });

  it('cổng trừ tiền xong mà mất phản hồi: 202, đơn không bị nhả; đối soát hỏi lại cổng và chốt đúng 1 lần', async () => {
    const user = newUser();
    const order = await ready(user);
    gateway.mode = 'lost';
    const res = await pay(user, order);
    expect(res.status).toBe(202);
    expect(res.body.outcome).toBe('pending');
    expect(await orderStatus(order.orderId)).toBe('paying');
    gateway.mode = 'ok';
    await payment.reconcile(0);
    expect(await orderStatus(order.orderId)).toBe('paid');
    await payment.reconcile(0);
    expect(await chargesAtGateway(order.orderId)).toBe(1);
  });

  it('cổng sập trước khi trừ: đối soát huỷ lệnh ở cổng, coi là thất bại, đơn về pending để trả lại', async () => {
    const user = newUser();
    const order = await ready(user);
    gateway.mode = 'down';
    expect((await pay(user, order)).status).toBe(202);
    gateway.mode = 'ok';
    await payment.reconcile(0);
    expect(await orderStatus(order.orderId)).toBe('pending');
    expect((await pool.query(`select code from commerce.mock_gateway_ops where gateway_key = $1`, [`charge:${order.orderId}:1`])).rows[0].code).toBe('voided');
    expect((await pay(user, order)).body.outcome).toBe('paid');
  });

  it('tiền về khi đơn đã hết hạn: không chốt đơn, tự hoàn tiền (bù), chỗ không bị bán', async () => {
    const user = newUser();
    const checkIn = addDays(TODAY_DATE, 12);
    const order = await ready(user, checkIn);
    gateway.mode = 'lost';
    await pay(user, order);
    // Giả lập job nhả chỗ (TF30) đã chạy trong lúc chờ cổng.
    await pool.query(`update commerce.orders set status = 'expired' where id = $1`, [order.orderId]);
    gateway.mode = 'ok';
    await payment.reconcile(0);
    expect(await orderStatus(order.orderId)).toBe('expired');
    const refunds = (await pool.query('select status, amount from commerce.refunds where order_id = $1', [order.orderId])).rows;
    expect(refunds).toEqual([{ status: 'succeeded', amount: String(order.total) }]);
  });

  it('2 người tranh phòng cuối cùng lúc: đúng 1 người giữ được, người kia 409, không giữ quá số phòng', async () => {
    const checkIn = addDays(TODAY_DATE, 25);
    await pool.query('update commerce.room_inventory set total = held + sold + 1 where room_type_id = $1 and date in ($2, $3)', [roomTypeId, checkIn, addDays(checkIn, 1)]);
    const [a, b] = await Promise.all([holdRoom(newUser(), checkIn), holdRoom(newUser(), checkIn)]);
    expect([a.status, b.status].sort((x, y) => x - y)).toEqual([201, 409]);
    const cell = await inventoryOf(checkIn);
    expect(cell.held + cell.sold).toBeLessThanOrEqual(cell.total);
  });

  it('chờ khoá quá 2 giây: trả 409 thử lại, không giữ chỗ, nhả khoá xong đặt được', async () => {
    const checkIn = addDays(TODAY_DATE, 27);
    const before = await inventoryOf(checkIn);
    const locker = await pool.connect();
    try {
      await locker.query('begin');
      await locker.query('select 1 from commerce.room_inventory where room_type_id = $1 and date = $2 for update', [roomTypeId, checkIn]);
      const startedAt = Date.now();
      const blocked = await holdRoom(newUser(), checkIn);
      expect(blocked.status, JSON.stringify(blocked.body)).toBe(409);
      expect(blocked.body.reason).toBe('LOCK_TIMEOUT');
      expect(Date.now() - startedAt).toBeLessThan(2_900);
      await locker.query('rollback');
    } finally {
      locker.release();
    }
    expect((await inventoryOf(checkIn)).held).toBe(before.held);
    expect((await holdRoom(newUser(), checkIn)).status).toBe(201);
  });

  it('giữ giỏ thiếu một mục thì không giữ gì; giỏ mới thay giỏ cũ và trả chỗ cũ về kho', async () => {
    const user = newUser();
    const checkIn = addDays(TODAY_DATE, 30);
    await pool.query('update commerce.flight_inventory set total = held + sold where flight_id = $1 and date = $2', [flightId, checkIn]);
    const before = await inventoryOf(checkIn);
    const failed = await http()
      .post('/api/checkout')
      .set({ ...user.auth, ...key() })
      .send({ adults: 2, items: [{ productId: roomTypeId, checkIn, checkOut: addDays(checkIn, 1), qty: 1 }, { productId: flightId, checkIn }] });
    expect(failed.status).toBe(409);
    expect((await inventoryOf(checkIn)).held).toBe(before.held);

    const first = (await holdRoom(user, checkIn, 1)).body;
    const second = (await holdRoom(user, addDays(checkIn, 3), 1)).body;
    expect(await orderStatus(first.orderId)).toBe('cancelled');
    expect(await orderStatus(second.orderId)).toBe('pending');
    expect((await inventoryOf(checkIn)).held).toBe(before.held);
  });

  it('đoàn chia nhiều mục phòng: sức chứa tính gộp trong một khách sạn, một mục không đủ thì 409', async () => {
    const user = newUser();
    const checkIn = addDays(TODAY_DATE, 35);
    const line = { productId: roomTypeId, checkIn, checkOut: addDays(checkIn, 1), qty: 1 };
    const { rows } = await pool.query<{ max_guests: number }>('select max_guests from commerce.room_types where id = $1', [roomTypeId]);
    const adults = rows[0]!.max_guests + 1;

    const single = await http().post('/api/checkout').set({ ...user.auth, ...key() }).send({ adults, items: [line] });
    expect(single.status).toBe(409);
    expect(single.body.reason).toBe('NOT_ENOUGH_ROOMS');

    const split = await http().post('/api/checkout').set({ ...user.auth, ...key() }).send({ adults, items: [line, line] });
    expect(split.status).toBe(201);
    expect(split.body.items).toHaveLength(2);
  });

  it('khách sạn: người lớn, trẻ em, em bé đều chiếm chỗ; trẻ em trả 1/3 suất, em bé miễn phí; mỗi phòng cần một người lớn', async () => {
    const user = newUser();
    const checkIn = addDays(TODAY_DATE, 33);
    const line = { productId: roomTypeId, checkIn, checkOut: addDays(checkIn, 1), qty: 1 };
    const { rows } = await pool.query<{ max_guests: number }>('select max_guests from commerce.room_types where id = $1', [roomTypeId]);
    const maxGuests = rows[0]!.max_guests;
    const send = (body: object) => http().post('/api/checkout').set({ ...user.auth, ...key() }).send(body);

    expect((await send({ adults: maxGuests, children: 1, items: [line] })).body.reason).toBe('NOT_ENOUGH_ROOMS');
    expect((await send({ adults: maxGuests, infants: 1, items: [line] })).body.reason).toBe('NOT_ENOUGH_ROOMS');
    expect((await send({ adults: 1, items: [line, line] })).body.reason).toBe('NOT_ENOUGH_ADULTS');
    const base = (await send({ adults: 1, items: [line] })).body.total as number;
    expect((await send({ adults: 1, infants: 1, items: [line] })).body.total).toBe(base);
    const withChild = await send({ adults: 1, children: 1, items: [line] });
    expect(withChild.status).toBe(201);
    expect(withChild.body.total).toBe(base - Math.round((2 * base) / (3 * maxGuests) / 10_000) * 10_000);
    expect(withChild.body.passengerTypes).toEqual(['child']);
  });

  describe('TF70 huỷ đơn đã thanh toán', () => {
    const paidOrder = async (days: number) => {
      const user = newUser();
      const checkIn = addDays(TODAY_DATE, days);
      const order = await ready(user, checkIn);
      expect((await pay(user, order)).status).toBe(200);
      return { user, order, checkIn };
    };
    const cancel = (user: { auth: Record<string, string> }, id: string, headers = key()) => http().post(`/api/checkout/${id}/cancel-paid`).set({ ...user.auth, ...headers });
    const quote = (user: { auth: Record<string, string> }, id: string) => http().get(`/api/checkout/${id}/cancel-quote`).set(user.auth);
    const refundsOf = async (id: string) => (await pool.query<{ amount: string; status: string }>('select amount, status from commerce.refunds where order_id = $1', [id])).rows;
    const roomSold = async (date: string) => (await pool.query<{ sold: number }>('select sold from commerce.room_inventory where room_type_id = $1 and date = $2', [roomTypeId, date])).rows[0]!.sold;

    it('còn hạn: hoàn 100%, chỗ về kho, có sự kiện; gửi lại cùng key không hoàn thêm, key mới bị 409', async () => {
      const { user, order, checkIn } = await paidOrder(21);
      expect((await http().get(`/api/checkout/${order.orderId}`).set(user.auth).expect(200)).body).toMatchObject({ status: 'paid', cancelledAt: null, refund: null });
      const sold = await roomSold(checkIn);
      expect((await quote(user, order.orderId)).body.quote).toMatchObject({ isCancellable: true, refundAmount: order.total, feeAmount: 0 });
      const headers = key();
      const first = await cancel(user, order.orderId, headers).expect(200);
      expect(first.body).toMatchObject({ status: 'cancelled', refundAmount: order.total, feeAmount: 0, refundStatus: 'refunded' });
      expect(await roomSold(checkIn)).toBe(sold - 1);
      expect(await orderStatus(order.orderId)).toBe('cancelled');
      expect((await cancel(user, order.orderId, headers).expect(200)).body).toEqual(first.body);
      expect((await cancel(user, order.orderId)).status).toBe(409);
      expect(await refundsOf(order.orderId)).toEqual([{ amount: String(order.total), status: 'succeeded' }]);
      const timestamps = (await pool.query<{ cancelled_at: Date; refunded_at: Date }>('select o.cancelled_at, r.updated_at as refunded_at from commerce.orders o join commerce.refunds r on r.order_id = o.id where o.id = $1', [order.orderId])).rows[0]!;
      const checkout = (await http().get(`/api/checkout/${order.orderId}`).set(user.auth).expect(200)).body;
      expect(checkout).toMatchObject({ status: 'cancelled', cancelledAt: timestamps.cancelled_at.toISOString() });
      expect(checkout.refund).toEqual({ amount: order.total, feeAmount: 0, status: 'refunded', method: 'card', bankCode: null, refundedAt: timestamps.refunded_at.toISOString() });
      const events = await pool.query("select payload from commerce.outbox_events where type = 'commerce.order.cancelled' and payload->>'orderId' = $1", [order.orderId]);
      expect(events.rowCount).toBe(1);
    });

    it('quá hạn: mất đêm đầu; 2 yêu cầu cùng lúc chỉ hoàn một lần', async () => {
      const { user, order } = await paidOrder(23);
      await pool.query("update commerce.order_items set free_cancel_until = '2020-01-01' where order_id = $1", [order.orderId]);
      const results = await Promise.all([cancel(user, order.orderId), cancel(user, order.orderId)]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      const done = results.find((r) => r.status === 200)!.body;
      expect(done.feeAmount).toBeGreaterThan(0);
      expect(done.refundAmount + done.feeAmount).toBe(order.total);
      expect(await refundsOf(order.orderId)).toHaveLength(1);
      const checkout = (await http().get(`/api/checkout/${order.orderId}`).set(user.auth).expect(200)).body;
      expect(checkout).toMatchObject({ status: 'cancelled', cancelledAt: expect.any(String), refund: { amount: done.refundAmount, feeAmount: done.feeAmount, status: 'refunded', method: 'card', bankCode: null, refundedAt: expect.any(String) } });
    });

    it('gói không hoàn thì không có khoản hoàn; đã tới ngày thì không huỷ được; đơn người khác 404', async () => {
      const noRefund = await paidOrder(14);
      await pool.query('update commerce.order_items set is_refundable = false, free_cancel_until = null where order_id = $1', [noRefund.order.orderId]);
      expect((await cancel(noRefund.user, noRefund.order.orderId).expect(200)).body).toMatchObject({ refundAmount: 0, refundStatus: 'none' });
      expect(await refundsOf(noRefund.order.orderId)).toEqual([]);
      const cancelledAt = (await pool.query<{ cancelled_at: Date }>('select cancelled_at from commerce.orders where id = $1', [noRefund.order.orderId])).rows[0]!.cancelled_at;
      expect((await http().get(`/api/checkout/${noRefund.order.orderId}`).set(noRefund.user.auth).expect(200)).body).toMatchObject({ status: 'cancelled', cancelledAt: cancelledAt.toISOString(), refund: null });

      const started = await paidOrder(16);
      expect((await cancel(newUser(), started.order.orderId)).status).toBe(404);
      await pool.query('update commerce.order_items set date = $2 where order_id = $1', [started.order.orderId, TODAY_DATE]);
      expect((await quote(started.user, started.order.orderId)).body.quote).toMatchObject({ isCancellable: false, reason: 'ALREADY_STARTED' });
      expect((await cancel(started.user, started.order.orderId)).status).toBe(409);
      expect(await orderStatus(started.order.orderId)).toBe('paid');
    });

    it('GET phản ánh hoàn VNPay cần kiểm tra, đang xử lý và thành công', async () => {
      const { user, order } = await paidOrder(18);
      await cancel(user, order.orderId).expect(200);
      // Đổi dữ liệu sau khi hoàn giả lập để chỉ kiểm phép chiếu, không gọi cổng thật.
      await pool.query("update commerce.payments set gateway = 'vnpay' where order_id = $1", [order.orderId]);
      await pool.query("update commerce.refunds set status = 'initiated', needs_review = true, gateway_bank_code = null, gateway_refunded_at = null where order_id = $1", [order.orderId]);
      const readCheckout = async () => (await http().get(`/api/checkout/${order.orderId}`).set(user.auth).expect(200)).body;
      expect((await readCheckout()).refund).toEqual({ amount: order.total, feeAmount: 0, status: 'needs_review', method: 'vnpay', bankCode: null, refundedAt: null });

      await pool.query('update commerce.refunds set needs_review = false where order_id = $1', [order.orderId]);
      expect((await readCheckout()).refund).toEqual({ amount: order.total, feeAmount: 0, status: 'processing', method: 'vnpay', bankCode: null, refundedAt: null });

      const refundedAt = '2026-11-10T04:22:33.000Z';
      await pool.query("update commerce.refunds set status = 'succeeded', gateway_bank_code = 'NCB', gateway_refunded_at = $2 where order_id = $1", [order.orderId, refundedAt]);
      expect((await readCheckout()).refund).toEqual({ amount: order.total, feeAmount: 0, status: 'refunded', method: 'vnpay', bankCode: 'NCB', refundedAt });
    });
  });

  it('vé bay có trẻ em, em bé: giữ ghế cho người lớn + trẻ em, giá theo loại khách, kiểm tuổi tại ngày bay', async () => {
    const user = newUser();
    const checkIn = addDays(TODAY_DATE, 36);
    const seats = async () =>
      (await pool.query<{ held: number }>('select held from commerce.flight_inventory where flight_id = $1 and date = $2', [flightId, checkIn])).rows[0]!.held;
    const heldBefore = await seats();
    const offer = await http().get(`/api/flights/${flightId}`).query({ date: checkIn, passengers: 2, children: 1, infants: 1 }).expect(200);
    const fare = offer.body.fares[0] as { code: string; pricePerPerson: number; childPrice: number; infantPrice: number; totalPrice: number };
    expect(fare.totalPrice).toBe(fare.pricePerPerson * 2 + fare.childPrice + fare.infantPrice);

    const tooManyInfants = await http().post('/api/checkout').set({ ...user.auth, ...key() }).send({ adults: 1, infants: 2, items: [{ productId: flightId, checkIn }] });
    expect(tooManyInfants.status).toBe(400);
    expect(tooManyInfants.body.errors).toEqual([expect.objectContaining({ field: 'infants' })]);

    const held = await http()
      .post('/api/checkout')
      .set({ ...user.auth, ...key() })
      .send({ adults: 2, children: 1, infants: 1, items: [{ productId: flightId, checkIn, ratePlanCode: fare.code }] });
    expect(held.status, JSON.stringify(held.body)).toBe(201);
    expect(held.body).toMatchObject({ adults: 2, children: 1, infants: 1, total: fare.totalPrice, passengersRequired: 4, passengerTypes: ['adult', 'adult', 'child', 'infant'] });
    // Đơn giá là giá người lớn, kèm giá trẻ em, em bé; tổng dòng = cả nhóm (không phải đơn giá × qty).
    expect(held.body.items[0]).toMatchObject({ qty: 3, unitPrice: fare.pricePerPerson, childUnitPrice: fare.childPrice, infantUnitPrice: fare.infantPrice, lineTotal: fare.totalPrice });
    expect((await seats()) - heldBefore).toBe(3);

    const travelYear = Number(checkIn.slice(0, 4));
    const guests = (infantBirthdate: string) => ({
      contact: { fullName: 'Bố Mẹ', phone: '0901234567' },
      guests: [
        { fullName: 'Bố', birthdate: '1990-01-01' },
        { fullName: 'Mẹ', birthdate: '1992-01-01' },
        { fullName: 'Con', birthdate: `${travelYear - 6}-01-01` },
        { fullName: 'Em bé', birthdate: infantBirthdate },
      ],
    });
    // Em bé 3 tuổi vào ngày bay là trẻ em, không phải em bé.
    const wrongAge = await http().put(`/api/checkout/${held.body.orderId}/guests`).set(user.auth).send(guests(`${travelYear - 3}-01-01`));
    expect(wrongAge.status).toBe(400);
    expect(wrongAge.body.errors).toEqual([{ field: 'guests[3].birthdate', message: 'Hành khách 4 là em bé, phải dưới 2 tuổi tới ngày bay chặng cuối.' }]);
    expect(wrongAge.body.fields).toEqual(['guests[3].birthdate']);
    const infantBirthdate = addDays(TODAY_DATE, -100);
    await http().put(`/api/checkout/${held.body.orderId}/guests`).set(user.auth).send(guests(infantBirthdate)).expect(200);
    const saved = await pool.query<{ full_name: string; passenger_type: string }>('select full_name, passenger_type from commerce.order_guests where order_id = $1 order by passenger_type, full_name', [held.body.orderId]);
    expect(saved.rows.map((g) => [g.full_name, g.passenger_type])).toEqual([
      ['Bố', 'adult'],
      ['Mẹ', 'adult'],
      ['Con', 'child'],
      ['Em bé', 'infant'],
    ]);
    expect((await http().get(`/api/checkout/${held.body.orderId}`).set(user.auth).expect(200)).body.isGuestInfoComplete).toBe(true);
    await http().post(`/api/checkout/${held.body.orderId}/cancel`).set({ ...user.auth, ...key() }).expect(200);
    expect(await seats()).toBe(heldBefore);
  });

  it('3D Secure: sai OTP thì 402, chỗ vẫn giữ; thẻ khác đúng OTP thì chốt', async () => {
    const user = newUser();
    const order = await ready(user);
    const challenge = await pay(user, order, THREE_DS);
    expect(challenge.body.outcome).toBe('requires_action');
    const wrong = await http().post(`/api/checkout/${order.orderId}/3ds`).set({ ...user.auth, ...key() }).send({ challengeId: challenge.body.challengeId, otp: '000000' });
    expect(wrong.status).toBe(402);
    expect(await orderStatus(order.orderId)).toBe('pending');
    const again = await pay(user, order, THREE_DS);
    const right = await http().post(`/api/checkout/${order.orderId}/3ds`).set({ ...user.auth, ...key() }).send({ challengeId: again.body.challengeId, otp: '123456' });
    expect(right.body.outcome, JSON.stringify(right.body)).toBe('paid');
  });

  it('giá đổi trong lúc giữ chỗ: 409 PRICE_CHANGED, chưa trừ tiền; xác nhận giá mới thì trả được', async () => {
    const user = newUser();
    const checkIn = addDays(TODAY_DATE, 15);
    const order = await ready(user, checkIn);
    await pool.query('update commerce.room_rates set price = price + 500000 where room_type_id = $1 and date = $2', [roomTypeId, checkIn]);
    const res = await pay(user, order);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ reason: 'PRICE_CHANGED', oldTotal: order.total });
    expect(await chargesAtGateway(order.orderId)).toBe(0);
    expect((await pay(user, { orderId: order.orderId, total: res.body.newTotal })).body.outcome).toBe('paid');
  });

  it('đơn của người khác thì 404; thiếu Idempotency-Key thì 400; chưa đủ thông tin khách thì 400', async () => {
    const owner = newUser();
    const order = await ready(owner);
    await http().get(`/api/checkout/${order.orderId}`).set(newUser().auth).expect(404);
    await http().post(`/api/checkout/${order.orderId}/pay`).set(owner.auth).send({ paymentToken: 'x', expectedTotal: 1, acceptedPolicyVersion: POLICY }).expect(400);
    const other = newUser();
    const held = (await holdRoom(other)).body;
    expect((await pay(other, held)).status).toBe(400);
  });

  it('CommerceFacade.verifyCompletedBooking: đơn đã trả nhưng chưa tới ngày trả phòng thì false; đúng người mới true', async () => {
    const user = newUser();
    const order = await ready(user);
    await pay(user, order);
    expect(await facade.verifyCompletedBooking(order.orderId, user.userId)).toBe(false);
    await pool.query(`update commerce.order_items set date = $2 where order_id = $1`, [order.orderId, addDays(TODAY_DATE, -5)]);
    expect(await facade.verifyCompletedBooking(order.orderId, user.userId)).toBe(true);
    expect(await facade.verifyCompletedBooking(order.orderId, randomUUID())).toBe(false);
    expect(await facade.verifyCompletedBooking('khong-phai-uuid', user.userId)).toBe(false);
  });

  it('VNPay: tạo URL đã ký; IPN đúng chữ ký thì chốt đơn; gửi lại IPN trả 02; sai chữ ký 97; sai số tiền 04', async () => {
    const user = newUser();
    const order = await ready(user);
    const start = await http().post(`/api/checkout/${order.orderId}/pay-vnpay`).set({ ...user.auth, ...key() }).send({ expectedTotal: order.total, acceptedPolicyVersion: POLICY });
    expect(start.status, JSON.stringify(start.body)).toBe(200);
    const sent = Object.fromEntries(new URL(start.body.paymentUrl).searchParams);
    expect(sent).toMatchObject({ vnp_TmnCode: 'TESTTMN1', vnp_Amount: String(order.total * 100), vnp_Command: 'pay' });
    expect(await orderStatus(order.orderId)).toBe('paying');

    const callback = { vnp_TxnRef: sent.vnp_TxnRef!, vnp_Amount: sent.vnp_Amount!, vnp_ResponseCode: '00', vnp_TransactionStatus: '00', vnp_TransactionNo: '14000001', vnp_TmnCode: 'TESTTMN1' };
    expect((await http().get('/api/payments/vnpay/ipn').query({ ...signVnpay(callback), vnp_Amount: '1' })).body.RspCode).toBe('97');
    expect((await http().get('/api/payments/vnpay/ipn').query(signVnpay({ ...callback, vnp_Amount: '100' }))).body.RspCode).toBe('04');
    expect((await http().get('/api/payments/vnpay/ipn').query(signVnpay(callback))).body).toEqual({ RspCode: '00', Message: 'Confirm Success' });
    expect(await orderStatus(order.orderId)).toBe('paid');
    expect((await http().get('/api/payments/vnpay/ipn').query(signVnpay(callback))).body.RspCode).toBe('02');
    const back = await http().get('/api/payments/vnpay/return').query(signVnpay(callback));
    expect(back.body).toEqual({ orderId: order.orderId, isValidSignature: true, isSuccess: true });
  });

  it('VNPay: khách huỷ trên trang VNPay (mã 24) thì đơn về pending để trả lại', async () => {
    const user = newUser();
    const order = await ready(user);
    const start = await http().post(`/api/checkout/${order.orderId}/pay-vnpay`).set({ ...user.auth, ...key() }).send({ expectedTotal: order.total, acceptedPolicyVersion: POLICY });
    const sent = Object.fromEntries(new URL(start.body.paymentUrl).searchParams);
    const res = await http().get('/api/payments/vnpay/return').query(signVnpay({ vnp_TxnRef: sent.vnp_TxnRef!, vnp_Amount: sent.vnp_Amount!, vnp_ResponseCode: '24', vnp_TransactionStatus: '02' }));
    expect(res.body.isSuccess).toBe(false);
    expect(await orderStatus(order.orderId)).toBe('pending');
  });

  it('VNPay: khách bỏ ngang trang VNPay rồi trả lại thì tạo lần trả mới, không kẹt ở paying', async () => {
    const user = newUser();
    const order = await ready(user, addDays(TODAY_DATE, 33));
    const start = () => http().post(`/api/checkout/${order.orderId}/pay-vnpay`).set({ ...user.auth, ...key() }).send({ expectedTotal: order.total, acceptedPolicyVersion: POLICY });
    const first = Object.fromEntries(new URL((await start()).body.paymentUrl).searchParams);
    const again = await start();
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    const second = Object.fromEntries(new URL(again.body.paymentUrl).searchParams);
    expect(second.vnp_TxnRef).not.toBe(first.vnp_TxnRef);
    const rows = (await pool.query('select status, failure_code from commerce.payments where order_id = $1 order by created_at', [order.orderId])).rows;
    expect(rows).toEqual([{ status: 'failed', failure_code: 'vnpay_abandoned' }, { status: 'initiated', failure_code: null }]);
    const paid = await http().get('/api/payments/vnpay/ipn').query(signVnpay({ vnp_TxnRef: second.vnp_TxnRef!, vnp_Amount: second.vnp_Amount!, vnp_ResponseCode: '00', vnp_TransactionStatus: '00', vnp_TransactionNo: '14000002' }));
    expect(paid.body.RspCode).toBe('00');
    expect(await orderStatus(order.orderId)).toBe('paid');
  });

  describe('TF37 chuyến đi của tôi: GET /api/checkout', () => {
    /** Thêm phiên đăng nhập thứ hai của cùng tài khoản, như mở app sau khi đặt trên web. */
    const otherDevice = (user: { userId: string }) => {
      const t = `token-${randomUUID()}`;
      users.set(t, { userId: user.userId, role: 'member', sid: randomUUID(), exp: 9_999_999_999 });
      return { Authorization: `Bearer ${t}` };
    };
    // Ngày 30 trở đi chỉ test TF37 dùng: các test TF29 phía trên tranh phòng cuối ở ngày gần.
    beforeAll(async () => {
      await pool.query('update commerce.room_inventory set total = 100 where room_type_id = $1 and date >= $2', [roomTypeId, addDays(TODAY_DATE, 30)]);
    });
    const listTrips = (auth: Record<string, string>, query: Record<string, string | number> = {}) => http().get('/api/checkout').set(auth).query(query);

    it('đặt trên web xong, app (phiên khác) thấy ngay chuyến đó; trả tiền xong thấy paid', async () => {
      const web = newUser();
      const app2 = otherDevice(web);
      const checkIn = addDays(TODAY_DATE, 30);
      const order = await ready(web, checkIn);

      const seen = await listTrips(app2);
      expect(seen.status, JSON.stringify(seen.body)).toBe(200);
      expect(seen.headers['cache-control']).toBe('no-store');
      expect((await http().get(`/api/checkout/${order.orderId}`).set(app2)).headers['cache-control']).toBe('no-store');
      expect(seen.body.nextCursor).toBeNull();
      expect(seen.body.trips).toHaveLength(1);
      expect(seen.body.trips[0]).toMatchObject({
        orderId: order.orderId,
        status: 'pending',
        total: order.total,
        adults: 2,
        paidAt: null,
        startDate: checkIn,
        endDate: addDays(checkIn, 2),
        items: [{ productType: 'room', productId: roomTypeId, propertyName: roomPropertyName, date: checkIn, dateTo: addDays(checkIn, 2), nights: 2 }],
      });
      expect((await http().get(`/api/checkout/${order.orderId}`).set(web.auth)).body.items[0].propertyName).toBe(roomPropertyName);

      expect((await pay(web, order)).status).toBe(200);
      const after = await listTrips(app2);
      expect(after.body.trips[0]).toMatchObject({ orderId: order.orderId, status: 'paid', confirmationCode: expect.stringMatching(/^TF-/), paidAt: expect.any(String) });
    });

    it('không thấy đơn của người khác; chưa có đơn thì danh sách rỗng', async () => {
      const owner = newUser();
      await holdRoom(owner, addDays(TODAY_DATE, 30));
      const stranger = newUser();
      const res = await listTrips(stranger.auth);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ trips: [], nextCursor: null });
    });

    it('lọc theo ?status=; đơn chưa trả đã hết hạn hoặc huỷ thì ẩn, đơn đã trả rồi huỷ vẫn hiện; mới đặt trước', async () => {
      const user = newUser();
      const expired = (await holdRoom(user, addDays(TODAY_DATE, 31))).body.orderId as string;
      await pool.query(`update commerce.orders set status = 'expired' where id = $1`, [expired]);
      const cancelled = (await holdRoom(user, addDays(TODAY_DATE, 32))).body.orderId as string;
      expect((await http().post(`/api/checkout/${cancelled}/cancel`).set({ ...user.auth, ...key() })).status).toBeLessThan(300);

      // Hai đơn này coi như đã trả tiền trước đó, để kiểm cả hai trạng thái vẫn hiện.
      await pool.query(`update commerce.orders set paid_at = now() where id = any($1)`, [[expired, cancelled]]);
      const hidden = (await holdRoom(user, addDays(TODAY_DATE, 40))).body.orderId as string;
      await pool.query(`update commerce.orders set status = 'expired' where id = $1`, [hidden]);
      const pending = (await holdRoom(user, addDays(TODAY_DATE, 33))).body.orderId as string;

      const all = await listTrips(user.auth);
      expect(all.body.trips.map((t: { orderId: string }) => t.orderId)).toEqual([pending, cancelled, expired]);
      // Mỗi chuyến mang đúng mục của đơn đó (lấy mục cả trang trong một câu truy vấn rồi chia lại).
      expect(all.body.trips.map((t: { items: { date: string }[] }) => t.items.map((i) => i.date))).toEqual([[addDays(TODAY_DATE, 33)], [addDays(TODAY_DATE, 32)], [addDays(TODAY_DATE, 31)]]);
      const some = await listTrips(user.auth, { status: 'expired,cancelled' });
      expect(some.body.trips.map((t: { orderId: string; status: string }) => [t.orderId, t.status])).toEqual([
        [cancelled, 'cancelled'],
        [expired, 'expired'],
      ]);
      expect((await listTrips(user.auth, { status: 'paid' })).body.trips).toEqual([]);
    });

    it('phân trang bằng cursor không trùng, không sót, kể cả đơn cùng mili giây khác micro giây', async () => {
      const user = newUser();
      const ids: string[] = [];
      for (let i = 0; i < 5; i++) {
        const held = await holdRoom(user, addDays(TODAY_DATE, 34 + i), 1);
        expect(held.status, JSON.stringify(held.body)).toBe(201);
        ids.push(held.body.orderId as string);
      }
      // Giữ giỏ mới huỷ giỏ cũ; đánh dấu đã trả để các đơn vẫn hiện trong danh sách khi kiểm phân trang.
      await pool.query(`update commerce.orders set status = 'paid', paid_at = now() where id = any($1)`, [ids]);
      // Ba đơn cùng mili giây (khác micro giây), nằm vắt qua ranh giới trang.
      const base = '2026-11-01T03:00:00.123';
      await pool.query(`update commerce.orders set created_at = $2::timestamptz where id = $1`, [ids[0], '2026-11-01T02:00:00Z']);
      await pool.query(`update commerce.orders set created_at = $2::timestamptz where id = $1`, [ids[1], `${base}100Z`]);
      await pool.query(`update commerce.orders set created_at = $2::timestamptz where id = $1`, [ids[2], `${base}900Z`]);
      await pool.query(`update commerce.orders set created_at = $2::timestamptz where id = $1`, [ids[3], `${base}500Z`]);
      await pool.query(`update commerce.orders set created_at = $2::timestamptz where id = $1`, [ids[4], '2026-11-01T04:00:00Z']);

      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const res = await listTrips(user.auth, cursor ? { limit: 2, cursor } : { limit: 2 });
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(res.body.trips.length).toBeLessThanOrEqual(2);
        seen.push(...res.body.trips.map((t: { orderId: string }) => t.orderId));
        cursor = res.body.nextCursor;
        pages++;
      } while (cursor && pages < 10);
      expect(pages).toBe(3);
      expect(seen).toHaveLength(5);
      expect(new Set(seen).size).toBe(5);
      expect(seen[0]).toBe(ids[4]);
      expect(seen[4]).toBe(ids[0]);
    });

    it('sự kiện commerce.order.paid mang mã xác nhận và email liên hệ để gửi email xác nhận', async () => {
      const user = newUser();
      const held = await holdRoom(user, addDays(TODAY_DATE, 30), 1);
      expect(held.status, JSON.stringify(held.body)).toBe(201);
      const guests = await http().put(`/api/checkout/${held.body.orderId}/guests`).set(user.auth).send({ contact: { fullName: 'Người Đặt', phone: '0909000111', email: 'nguoidat@example.com' }, guests: [] });
      expect(guests.status, JSON.stringify(guests.body)).toBe(200);
      const paid = await pay(user, held.body);
      expect(paid.status, JSON.stringify(paid.body)).toBe(200);
      const events = await pool.query(`select payload from commerce.outbox_events where type = 'commerce.order.paid' and payload->>'orderId' = $1`, [held.body.orderId]);
      expect(events.rows[0].payload).toMatchObject({ confirmationCode: paid.body.confirmationCode, contactName: 'Người Đặt', contactEmail: 'nguoidat@example.com' });
      expect(events.rows[0].payload.items[0]).toMatchObject({ productName: expect.any(String), propertyName: roomPropertyName, ratePlanName: expect.any(String), flight: null });
    });

    it('tham số sai trả 400', async () => {
      const user = newUser();
      expect((await listTrips(user.auth, { status: 'shipped' })).status).toBe(400);
      expect((await listTrips(user.auth, { cursor: 'khong-phai-cursor' })).status).toBe(400);
      expect((await listTrips(user.auth, { limit: 0 })).status).toBe(400);
      expect((await listTrips(user.auth, { limit: 51 })).status).toBe(400);
      expect((await http().get('/api/checkout')).status).toBe(401);
    });
  });
});
