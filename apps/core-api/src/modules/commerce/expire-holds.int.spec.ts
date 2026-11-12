import 'reflect-metadata';
import { createHmac, randomUUID } from 'node:crypto';
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
import { ExpireHoldsUseCases } from './booking/application/expire-holds.use-cases.js';
import { ORDER_STORE, type OrderStore } from './booking/application/ports.js';
import { CommerceModule } from './commerce.module.js';
import { seedCatalog } from './db/seed/seed-catalog.js';
import { CalendarUseCases } from './inventory/application/calendar.use-cases.js';
import { TODAY } from './inventory/application/ports.js';
import { DrizzleCommerceStore } from './inventory/infra/drizzle-commerce.store.js';
import type { ChargeResult } from './payment/application/gateway.port.js';
import { PAYMENT_GATEWAY } from './payment/application/gateway.port.js';
import { PaymentUseCases } from './payment/application/payment.use-cases.js';
import { VNPAY_CONFIG } from './payment/application/vnpay.use-cases.js';
import { REFUND_GATEWAYS, type RefundClient } from './payment/application/refund-gateways.port.js';
import { buildSignData } from './payment/domain/vnpay-signature.js';
import { MockGateway } from './payment/infra/mock-gateway.js';

const TODAY_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const POLICY = '2026-11-03';
const VISA = '4242424242424242';
const THREE_DS = '4000002500003155';
const VNPAY_TEST_CONFIG = { tmnCode: 'TESTTMN1', hashSecret: 'TEST_SECRET_FOR_SIGNING', paymentUrl: 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html', returnUrl: 'http://localhost/return' };
const vnpayRefundClient: RefundClient = {
  refund: async ({ requestId }) => ({ status: 'succeeded', ref: `vnpay-refund:${requestId}` }),
  query: async ({ requestId }) => ({ status: 'succeeded', ref: `vnpay-refund:${requestId}` }),
};
const signVnpay = (params: Record<string, string>) => ({
  ...params,
  vnp_SecureHash: createHmac('sha512', VNPAY_TEST_CONFIG.hashSecret).update(buildSignData(params)).digest('hex'),
});

class FlakyGateway extends MockGateway {
  mode: 'ok' | 'lost' | 'down' = 'ok';
  override async charge(input: { amount: number; token: string; gatewayKey: string }): Promise<ChargeResult> {
    if (this.mode === 'down') throw new Error('gateway down');
    const result = await super.charge(input);
    if (this.mode === 'lost') throw new Error('response lost');
    return result;
  }
}

describe('TF30 nhả chỗ quá hạn trên Postgres thật', () => {
  let postgres: PostgresFixture;
  let pool: pg.Pool;
  let db: Db;
  let app: INestApplication;
  let gateway: FlakyGateway;
  let payment: PaymentUseCases;
  let expiry: ExpireHoldsUseCases;
  let store: OrderStore;
  let roomTypeId: string;
  const users = new Map<string, AuthUser>();

  const newUser = () => {
    const bearer = `token-${randomUUID()}`;
    users.set(bearer, { userId: randomUUID(), role: 'member', sid: randomUUID(), exp: 9_999_999_999 });
    return { auth: { Authorization: `Bearer ${bearer}` }, userId: users.get(bearer)!.userId };
  };
  const http = () => request(app.getHttpServer());
  const key = () => ({ 'Idempotency-Key': randomUUID() });

  async function holdRoom(user: { auth: Record<string, string> }, checkIn = addDays(TODAY_DATE, 20), nights = 2) {
    return http().post('/api/checkout').set({ ...user.auth, ...key() })
      .send({ adults: 2, items: [{ productId: roomTypeId, checkIn, checkOut: addDays(checkIn, nights), qty: 1 }] });
  }
  async function ready(user: { auth: Record<string, string> }, checkIn?: string) {
    const held = await holdRoom(user, checkIn);
    expect(held.status, JSON.stringify(held.body)).toBe(201);
    const guests = await http().put(`/api/checkout/${held.body.orderId}/guests`).set(user.auth)
      .send({ contact: { fullName: 'Khách Thử', phone: '0901234567' }, guests: [] });
    expect(guests.status, JSON.stringify(guests.body)).toBe(200);
    return held.body as { orderId: string; total: number; items: { date: string; nights: number }[] };
  }
  const token = async (card = VISA) => (await http().post('/api/mock-gateway/tokens').send({ cardNumber: card }).expect(200)).body.paymentToken as string;
  const pay = async (user: { auth: Record<string, string> }, order: { orderId: string; total: number }, card = VISA, headers = key()) => {
    const paymentToken = await token(card);
    return http().post(`/api/checkout/${order.orderId}/pay`).set({ ...user.auth, ...headers })
      .send({ paymentToken, expectedTotal: order.total, acceptedPolicyVersion: POLICY });
  };
  const inventoryOf = async (date: string) =>
    (await pool.query<{ total: number; held: number; sold: number }>('select total, held, sold from commerce.room_inventory where room_type_id = $1 and date = $2', [roomTypeId, date])).rows[0]!;
  const orderStatus = async (id: string) => (await pool.query<{ status: string }>('select status from commerce.orders where id = $1', [id])).rows[0]!.status;
  const chargesAtGateway = async (orderId: string) =>
    Number((await pool.query(`select count(*) as n from commerce.mock_gateway_ops where op = 'charge' and status = 'succeeded' and gateway_key like $1`, [`charge:${orderId}:%`])).rows[0].n);
  const expireHold = async (orderId: string) => {
    await pool.query("update commerce.orders set hold_expires_at = now() - interval '1 minute' where id = $1", [orderId]);
  };
  const ageCharge = async (orderId: string, minutes: number) => {
    await pool.query("update commerce.payments set created_at = now() - make_interval(mins => $2) where order_id = $1 and status in ('initiated','requires_action')", [orderId, minutes]);
  };
  const startVnpay = async (user: { auth: Record<string, string> }, order: { orderId: string; total: number }) => {
    const res = await http().post(`/api/checkout/${order.orderId}/pay-vnpay`).set({ ...user.auth, ...key() })
      .send({ expectedTotal: order.total, acceptedPolicyVersion: POLICY });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return Object.fromEntries(new URL(res.body.paymentUrl).searchParams);
  };
  const vnpaySuccess = (sent: Record<string, string>, transactionNo: string) => signVnpay({
    vnp_TxnRef: sent.vnp_TxnRef!, vnp_Amount: sent.vnp_Amount!, vnp_ResponseCode: '00',
    vnp_TransactionStatus: '00', vnp_TransactionNo: transactionNo,
  });
  const paymentsOf = async (orderId: string) =>
    (await pool.query<{ id: string; status: string; failure_code: string | null; gateway_key: string; gateway_ref: string | null }>(
      'select id, status, failure_code, gateway_key, gateway_ref from commerce.payments where order_id = $1 order by created_at, id', [orderId],
    )).rows;
  const refundsOf = async (orderId: string) =>
    (await pool.query<{ payment_id: string; gateway_key: string; amount: string; reason: string; status: string; needs_review: boolean }>(
      'select payment_id, gateway_key, amount, reason, status, needs_review from commerce.refunds where order_id = $1 order by created_at, id', [orderId],
    )).rows;
  const runTwice = async () => { await expiry.expireHolds(); await expiry.expireHolds(); };

  beforeAll(async () => {
    postgres = await startPostgres();
    const url = postgres.buildModuleUrl('commerce');
    await migrateModule({ url, module: 'commerce', migrationsFolder: fileURLToPath(new URL('./db/migrations', import.meta.url)) });
    pool = createPool({ url, max: 20, applicationName: 'commerce-expire-holds-int' });
    db = createDb(pool);
    // Chỉ 220 khách sạn gốc: đủ cho test, không nạp 1.980 khách sạn OSM và đánh giá của chúng (quá giờ chuẩn bị).
    await seedCatalog(db, fileURLToPath(new URL('./db/seed/catalog.json', import.meta.url)), undefined, { shouldIncludeHotel: (id) => !id.startsWith('P-osm-') });
    await new CalendarUseCases(new DrizzleCommerceStore({ tx: db }), () => TODAY_DATE).openCalendarWindow(55);
    await pool.query('update commerce.room_inventory set stop_sell = false, cta = false, ctd = false, min_los = 1, total = 10');
    await pool.query('update commerce.flight_inventory set stop_sell = false, total = 10');
    roomTypeId = (await pool.query<{ id: string }>('select id from commerce.room_types where max_guests >= 2 order by id limit 1')).rows[0]!.id;
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
            verifier: async (bearer: string) => {
              const user = users.get(bearer);
              if (!user) throw new InvalidAccessTokenError();
              return user;
            },
            blocklist: new MemorySidBlocklist(),
          }),
        }),
        CommerceModule,
      ],
    })
      .overrideProvider(PAYMENT_GATEWAY).useValue(gateway)
      .overrideProvider(TODAY).useValue(() => TODAY_DATE)
      .overrideProvider(VNPAY_CONFIG).useValue(VNPAY_TEST_CONFIG)
      .overrideProvider(REFUND_GATEWAYS).useValue(new Map([['vnpay', vnpayRefundClient]]))
      .compile();
    app = moduleRef.createNestApplication();
    applyGlobalPrefix(app);
    // Nghe cổng thật: 20 request cùng lúc đi chung một server, không để supertest mở server tạm cho từng request.
    await app.listen(0);
    payment = moduleRef.get(PaymentUseCases);
    expiry = moduleRef.get(ExpireHoldsUseCases);
    store = moduleRef.get(ORDER_STORE);
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

  beforeEach(() => { gateway.mode = 'ok'; });

  it('đơn pending quá hạn được nhả đúng một lần dù job chạy hai lần', async () => {
    const date = addDays(TODAY_DATE, 2);
    const before = await inventoryOf(date);
    const order = await ready(newUser(), date);
    const other = await ready(newUser(), date);
    await expireHold(order.orderId);
    await runTwice();
    expect(await orderStatus(order.orderId)).toBe('expired');
    expect((await pool.query('select cancel_reason from commerce.orders where id = $1', [order.orderId])).rows[0].cancel_reason).toBeTruthy();
    expect(await orderStatus(other.orderId)).toBe('pending');
    expect((await inventoryOf(date)).held).toBe(before.held + 1);
  });

  it('đơn pending còn hạn không bị job đụng tới', async () => {
    const date = addDays(TODAY_DATE, 5);
    const before = await inventoryOf(date);
    const order = await ready(newUser(), date);
    await runTwice();
    expect(await orderStatus(order.orderId)).toBe('pending');
    expect((await inventoryOf(date)).held).toBe(before.held + 1);
  });

  it('3DS quá hạn thất bại, OTP cũ bị từ chối và tiền về muộn được hoàn', async () => {
    const date = addDays(TODAY_DATE, 8);
    const before = await inventoryOf(date);
    const user = newUser();
    const order = await ready(user, date);
    await ready(newUser(), date);
    const challenge = await pay(user, order, THREE_DS);
    expect(challenge.body.outcome).toBe('requires_action');
    await expireHold(order.orderId);
    await runTwice();
    const [charge] = await paymentsOf(order.orderId);
    expect(charge).toMatchObject({ status: 'failed', failure_code: '3ds_expired' });
    expect(await orderStatus(order.orderId)).toBe('expired');
    expect((await inventoryOf(date)).held).toBe(before.held + 1);
    const otp = await http().post(`/api/checkout/${order.orderId}/3ds`).set({ ...user.auth, ...key() })
      .send({ challengeId: challenge.body.challengeId, otp: '123456' });
    expect(otp.status).not.toBe(200);
    expect(await orderStatus(order.orderId)).toBe('expired');
    expect(await payment.applyResult(charge!.gateway_key, { status: 'succeeded', ref: 'mock_pi_late' })).toEqual({ kind: 'compensated' });
    expect(await payment.processRefunds(order.orderId)).toBe(1);
    expect(await refundsOf(order.orderId)).toEqual([{ payment_id: charge!.id, gateway_key: `refund:late:${charge!.id}`, amount: String(order.total), reason: 'late_success', status: 'succeeded', needs_review: false }]);
    expect(await orderStatus(order.orderId)).toBe('expired');
  });

  it('VNPay quá 15 phút bị nhả đúng một lần', async () => {
    const date = addDays(TODAY_DATE, 11);
    const before = await inventoryOf(date);
    const user = newUser();
    const order = await ready(user, date);
    await ready(newUser(), date);
    await startVnpay(user, order);
    await expireHold(order.orderId);
    await ageCharge(order.orderId, 16);
    await runTwice();
    expect(await paymentsOf(order.orderId)).toMatchObject([{ status: 'failed', failure_code: 'vnpay_expired' }]);
    expect(await orderStatus(order.orderId)).toBe('expired');
    expect((await inventoryOf(date)).held).toBe(before.held + 1);
  });

  it('VNPay còn trong cửa sổ 15 phút được giữ và IPN chốt đơn', async () => {
    const date = addDays(TODAY_DATE, 14);
    const before = await inventoryOf(date);
    const user = newUser();
    const order = await ready(user, date);
    const sent = await startVnpay(user, order);
    await expireHold(order.orderId);
    await ageCharge(order.orderId, 5);
    await runTwice();
    expect(await orderStatus(order.orderId)).toBe('paying');
    expect((await paymentsOf(order.orderId))[0]!.status).toBe('initiated');
    expect((await inventoryOf(date)).held).toBe(before.held + 1);
    expect((await http().get('/api/payments/vnpay/ipn').query(vnpaySuccess(sent, '15000005'))).body.RspCode).toBe('00');
    expect(await orderStatus(order.orderId)).toBe('paid');
  });

  it('thẻ đang chờ đối soát không bị nhả dù quá hạn lâu', async () => {
    const date = addDays(TODAY_DATE, 17);
    const before = await inventoryOf(date);
    const user = newUser();
    const order = await ready(user, date);
    gateway.mode = 'lost';
    expect((await pay(user, order)).status).toBe(202);
    await expireHold(order.orderId);
    await ageCharge(order.orderId, 60);
    await runTwice();
    expect(await orderStatus(order.orderId)).toBe('paying');
    expect((await paymentsOf(order.orderId))[0]!.status).toBe('initiated');
    expect((await inventoryOf(date)).held).toBe(before.held + 1);
    gateway.mode = 'ok';
    await payment.reconcile(0);
    expect(await orderStatus(order.orderId)).toBe('paid');
    expect(await chargesAtGateway(order.orderId)).toBe(1);
  });

  it('hai job tranh với trả tiền sau hạn chỉ nhả một lần và không trừ tiền', async () => {
    const date = addDays(TODAY_DATE, 20);
    const before = await inventoryOf(date);
    const user = newUser();
    const order = await ready(user, date);
    await ready(newUser(), date);
    await expireHold(order.orderId);
    const [, , paid] = await Promise.all([expiry.expireHolds(), expiry.expireHolds(), pay(user, order)]);
    expect(paid.status).toBe(410);
    expect(await orderStatus(order.orderId)).toBe('expired');
    expect((await inventoryOf(date)).held).toBe(before.held + 1);
    expect(await chargesAtGateway(order.orderId)).toBe(0);
    expect((await paymentsOf(order.orderId)).filter((p) => p.status === 'succeeded')).toHaveLength(0);
  });

  it('hai job cùng xử lý tám đơn quá hạn không nhả quá số chỗ', async () => {
    const date = addDays(TODAY_DATE, 23);
    const before = await inventoryOf(date);
    const orders = await Promise.all(Array.from({ length: 8 }, async () => ready(newUser(), date)));
    const other = await ready(newUser(), date);
    await Promise.all(orders.map((order) => expireHold(order.orderId)));
    const results = await Promise.all([expiry.expireHolds(), expiry.expireHolds()]);
    expect(results.reduce((sum, result) => sum + result.errors, 0)).toBe(0);
    for (const order of orders) expect(await orderStatus(order.orderId)).toBe('expired');
    expect(await orderStatus(other.orderId)).toBe('pending');
    expect((await inventoryOf(date)).held).toBe(before.held + 1);
  });

  it('job bỏ qua hàng đơn hoặc khoản trả đang bị khóa, lần sau xử lý được', async () => {
    const date = addDays(TODAY_DATE, 26);
    const before = await inventoryOf(date);
    const pending = await ready(newUser(), date);
    const user = newUser();
    const paying = await ready(user, date);
    await ready(newUser(), date);
    await expireHold(pending.orderId);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('select id from commerce.orders where id = $1 for update', [pending.orderId]);
      await expiry.expireHolds();
      expect(await orderStatus(pending.orderId)).toBe('pending');
      expect((await inventoryOf(date)).held).toBe(before.held + 3);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
    await expiry.expireHolds();
    expect(await orderStatus(pending.orderId)).toBe('expired');
    const sent = await startVnpay(user, paying);
    expect(sent.vnp_TxnRef).toBeTruthy();
    await expireHold(paying.orderId);
    await ageCharge(paying.orderId, 16);
    const charge = (await paymentsOf(paying.orderId))[0]!;
    const paymentClient = await pool.connect();
    try {
      await paymentClient.query('BEGIN');
      await paymentClient.query('select id from commerce.payments where id = $1 for update', [charge.id]);
      await expiry.expireHolds();
      expect(await orderStatus(paying.orderId)).toBe('paying');
      expect((await inventoryOf(date)).held).toBe(before.held + 2);
    } finally {
      await paymentClient.query('ROLLBACK');
      paymentClient.release();
    }
    await expiry.expireHolds();
    expect(await orderStatus(paying.orderId)).toBe('expired');
    expect((await inventoryOf(date)).held).toBe(before.held + 1);
  });

  it('20 người tranh 5 chỗ, ba người trả tiền, hai chỗ được bán lại', async () => {
    const date = addDays(TODAY_DATE, 29);
    const before = await inventoryOf(date);
    await pool.query('update commerce.room_inventory set total = held + sold + 5 where room_type_id = $1 and date in ($2, $3)', [roomTypeId, date, addDays(date, 1)]);
    const contenders = Array.from({ length: 20 }, () => newUser());
    const attempts = await Promise.all(contenders.map((user) => holdRoom(user, date)));
    expect(attempts.filter((res) => res.status === 201)).toHaveLength(5);
    expect(attempts.filter((res) => res.status === 409)).toHaveLength(15);
    let cell = await inventoryOf(date);
    expect(cell.held + cell.sold).toBeLessThanOrEqual(cell.total);
    const winners = attempts.flatMap((res, index) => res.status === 201 ? [{ user: contenders[index]!, order: res.body as { orderId: string; total: number } }] : []);
    for (const { user, order } of winners) {
      await http().put(`/api/checkout/${order.orderId}/guests`).set(user.auth)
        .send({ contact: { fullName: 'Khách Thử', phone: '0901234567' }, guests: [] }).expect(200);
    }
    const tokens = await Promise.all(winners.slice(0, 3).map(() => token()));
    const paid = await Promise.all(winners.slice(0, 3).map(({ user, order }, index) =>
      http().post(`/api/checkout/${order.orderId}/pay`).set({ ...user.auth, ...key() })
        .send({ paymentToken: tokens[index], expectedTotal: order.total, acceptedPolicyVersion: POLICY })));
    expect(paid.map((res) => res.status)).toEqual([200, 200, 200]);
    await Promise.all(winners.slice(3).map(({ order }) => expireHold(order.orderId)));
    await expiry.expireHolds();
    for (const { order } of winners.slice(3)) expect(await orderStatus(order.orderId)).toBe('expired');
    cell = await inventoryOf(date);
    expect(cell.held).toBe(before.held);
    expect(cell.sold).toBe(before.sold + 3);
    const next = await Promise.all(Array.from({ length: 3 }, () => holdRoom(newUser(), date)));
    expect(next.filter((res) => res.status === 201)).toHaveLength(2);
    expect(next.filter((res) => res.status === 409)).toHaveLength(1);
    cell = await inventoryOf(date);
    expect(cell.held + cell.sold).toBeLessThanOrEqual(cell.total);
  });

  it('VNPay báo thành công sau khi job nhả chỗ tạo đúng một hoàn tiền', async () => {
    const date = addDays(TODAY_DATE, 32);
    const user = newUser();
    const order = await ready(user, date);
    const sent = await startVnpay(user, order);
    await expireHold(order.orderId);
    await ageCharge(order.orderId, 16);
    await expiry.expireHolds();
    const after = await inventoryOf(date);
    const ipn = vnpaySuccess(sent, '15000011');
    expect((await http().get('/api/payments/vnpay/ipn').query(ipn)).body.RspCode).toBe('00');
    const [charge] = await paymentsOf(order.orderId);
    expect(charge).toMatchObject({ status: 'failed', failure_code: 'vnpay_expired', gateway_ref: '15000011' });
    expect(await refundsOf(order.orderId)).toEqual([{ payment_id: charge!.id, gateway_key: `refund:late:${charge!.id}`, amount: String(order.total), reason: 'late_success', status: 'succeeded', needs_review: false }]);
    expect(await orderStatus(order.orderId)).toBe('expired');
    expect(await inventoryOf(date)).toMatchObject({ held: after.held, sold: after.sold });
    expect((await http().get('/api/payments/vnpay/ipn').query(ipn)).body.RspCode).toBe('00');
    expect(await refundsOf(order.orderId)).toHaveLength(1);
    expect((await http().get('/api/payments/vnpay/return').query(ipn)).body).toEqual({ orderId: order.orderId, isValidSignature: true, isSuccess: false });
  });

  it('VNPay lần cũ báo thành công khi lần mới còn sống thì chỉ hoàn lần cũ', async () => {
    const date = addDays(TODAY_DATE, 35);
    const before = await inventoryOf(date);
    const user = newUser();
    const order = await ready(user, date);
    const first = await startVnpay(user, order);
    const second = await startVnpay(user, order);
    expect((await paymentsOf(order.orderId))[0]).toMatchObject({ status: 'failed', failure_code: 'vnpay_abandoned' });
    expect((await http().get('/api/payments/vnpay/ipn').query(vnpaySuccess(first, '15000012'))).body.RspCode).toBe('00');
    expect(await orderStatus(order.orderId)).toBe('paying');
    expect((await paymentsOf(order.orderId))[1]!.status).toBe('initiated');
    expect(await refundsOf(order.orderId)).toHaveLength(1);
    expect((await http().get('/api/payments/vnpay/ipn').query(vnpaySuccess(second, '15000013'))).body.RspCode).toBe('00');
    expect(await orderStatus(order.orderId)).toBe('paid');
    expect((await inventoryOf(date)).sold).toBe(before.sold + 1);
    expect((await paymentsOf(order.orderId))[1]!.status).toBe('succeeded');
    expect(await refundsOf(order.orderId)).toHaveLength(1);
  });

  it('hai lần VNPay bỏ ngang có hai hoàn tiền riêng và IPN thất bại không tạo hoàn', async () => {
    const date = addDays(TODAY_DATE, 38);
    const user = newUser();
    const order = await ready(user, date);
    const first = await startVnpay(user, order);
    const second = await startVnpay(user, order);
    const third = await startVnpay(user, order);
    const failed = signVnpay({ vnp_TxnRef: first.vnp_TxnRef!, vnp_Amount: first.vnp_Amount!, vnp_ResponseCode: '02', vnp_TransactionStatus: '02' });
    expect((await http().get('/api/payments/vnpay/ipn').query(failed)).body.RspCode).toBe('02');
    expect(await refundsOf(order.orderId)).toHaveLength(0);
    expect((await http().get('/api/payments/vnpay/ipn').query(vnpaySuccess(first, '15000014'))).body.RspCode).toBe('00');
    expect((await http().get('/api/payments/vnpay/ipn').query(vnpaySuccess(second, '15000015'))).body.RspCode).toBe('00');
    const charges = await paymentsOf(order.orderId);
    const refunds = await refundsOf(order.orderId);
    expect(refunds).toHaveLength(2);
    expect(refunds.map((refund) => refund.gateway_key).sort()).toEqual([`refund:late:${charges[0]!.id}`, `refund:late:${charges[1]!.id}`].sort());
    expect(new Set(refunds.map((refund) => refund.gateway_key)).size).toBe(2);
    expect((await http().get('/api/payments/vnpay/ipn').query(vnpaySuccess(third, '15000016'))).body.RspCode).toBe('00');
    expect(await orderStatus(order.orderId)).toBe('paid');
    expect(await refundsOf(order.orderId)).toHaveLength(2);
  });

  // Rủi ro chính của thiết kế: job khoá đơn trước, applyResult khoá khoản trừ trước; giỏ có ô không theo thứ tự sắp xếp.
  // Deadlock sẽ lộ thành errors của job, hoặc IPN / giữ chỗ trả 500.
  it('IPN chạy đua với 2 job và người giữ chỗ mới: không deadlock, mỗi đơn đúng một kết cục, kho khớp', async () => {
    const date = addDays(TODAY_DATE, 42);
    const nextDate = addDays(date, 1);
    const [roomA, roomB] = (await pool.query<{ id: string }>('select id from commerce.room_types where max_guests >= 2 order by id limit 2')).rows.map((r) => r.id);
    // Phòng B ngày đầu, phòng A ngày sau: thứ tự theo ngày ngược với thứ tự khoá (sản phẩm, ngày).
    const cart = { adults: 2, items: [{ productId: roomB!, checkIn: date, checkOut: nextDate, qty: 1 }, { productId: roomA!, checkIn: nextDate, checkOut: addDays(nextDate, 1), qty: 1 }] };
    const hold = (user: { auth: Record<string, string> }) => http().post('/api/checkout').set({ ...user.auth, ...key() }).send(cart);
    const cells = async () =>
      (await pool.query<{ held: number; sold: number }>(
        'select held, sold from commerce.room_inventory where (room_type_id = $1 and date = $2) or (room_type_id = $3 and date = $4) order by room_type_id',
        [roomA, nextDate, roomB, date],
      )).rows;
    const contenders = await Promise.all(
      Array.from({ length: 6 }, async () => {
        const user = newUser();
        const held = await hold(user);
        expect(held.status, JSON.stringify(held.body)).toBe(201);
        const order = held.body as { orderId: string; total: number };
        await http().put(`/api/checkout/${order.orderId}/guests`).set(user.auth).send({ contact: { fullName: 'Khách Thử', phone: '0901234567' }, guests: [] }).expect(200);
        const sent = await startVnpay(user, order);
        await expireHold(order.orderId);
        await ageCharge(order.orderId, 16);
        return { order, sent };
      }),
    );

    const newcomers = Array.from({ length: 2 }, () => newUser());
    const [jobA, jobB, ipns, holds] = await Promise.all([
      expiry.expireHolds(),
      expiry.expireHolds(),
      Promise.all(contenders.map(({ sent }, i) => http().get('/api/payments/vnpay/ipn').query(vnpaySuccess(sent, `1500002${i}`)))),
      Promise.all(newcomers.map(hold)),
    ]);
    // Job có thể bỏ qua đơn đang khoá; chạy lại để mọi đơn có kết cục.
    const jobC = await expiry.expireHolds();

    expect(jobA.errors + jobB.errors + jobC.errors).toBe(0);
    expect(ipns.map((res) => res.status)).toEqual(Array(6).fill(200));
    expect(ipns.map((res) => res.body.RspCode)).toEqual(Array(6).fill('00'));
    expect(holds.map((res) => res.status)).toEqual([201, 201]);
    let paidCount = 0;
    for (const { order } of contenders) {
      const status = await orderStatus(order.orderId);
      const [charge] = await paymentsOf(order.orderId);
      const refunds = await refundsOf(order.orderId);
      if (status === 'paid') {
        paidCount++;
        expect(charge!.status).toBe('succeeded');
        expect(refunds).toHaveLength(0);
      } else {
        expect(status).toBe('expired');
        expect(charge!.status).toBe('failed');
        expect(refunds).toHaveLength(1);
      }
    }
    expect(await cells()).toEqual([{ held: 2, sold: paidCount }, { held: 2, sold: paidCount }]);
  });

  it('đơn thẻ chờ đối soát và VNPay còn hạn không lọt vào danh sách, đơn nhả được thì có', async () => {
    const date = addDays(TODAY_DATE, 45);
    const cardUser = newUser();
    const card = await ready(cardUser, date);
    gateway.mode = 'lost';
    expect((await pay(cardUser, card)).status).toBe(202);
    gateway.mode = 'ok';
    const vnpayUser = newUser();
    const vnpay = await ready(vnpayUser, date);
    await startVnpay(vnpayUser, vnpay);
    const abandonedUser = newUser();
    const abandoned = await ready(abandonedUser, date);
    await startVnpay(abandonedUser, abandoned);
    await Promise.all([card, vnpay, abandoned].map((order) => expireHold(order.orderId)));
    await ageCharge(card.orderId, 60);
    await ageCharge(abandoned.orderId, 16);

    const now = new Date();
    const orderIds = await store.findExpiredHoldIds({ now, redirectGateway: 'vnpay', redirectStartedBefore: new Date(now.getTime() - 15 * 60_000), limit: 500 });
    expect(orderIds).toContain(abandoned.orderId);
    expect(orderIds).not.toContain(card.orderId);
    expect(orderIds).not.toContain(vnpay.orderId);

    // Danh sách đọc không khoá nên có thể đã cũ: job phải tự xét lại sau khi khoá, không tin danh sách.
    const before = await inventoryOf(date);
    vi.spyOn(store, 'findExpiredHoldIds').mockResolvedValueOnce([card.orderId, vnpay.orderId]);
    expect(await expiry.expireHolds()).toEqual({ expired: 0, skipped: 2, errors: 0 });
    expect(await orderStatus(card.orderId)).toBe('paying');
    expect(await orderStatus(vnpay.orderId)).toBe('paying');
    expect((await paymentsOf(card.orderId))[0]!.status).toBe('initiated');
    expect((await paymentsOf(vnpay.orderId))[0]!.status).toBe('initiated');
    expect((await inventoryOf(date)).held).toBe(before.held);
  });

  it('danh sách cũ trỏ tới đơn đã nhả hoặc đã trả: không nhả thêm lần nữa', async () => {
    const date = addDays(TODAY_DATE, 48);
    const expiredOrder = await ready(newUser(), date);
    const paidUser = newUser();
    const paidOrder = await ready(paidUser, date);
    expect((await pay(paidUser, paidOrder)).status).toBe(200);
    await ready(newUser(), date);
    await expireHold(expiredOrder.orderId);
    await expiry.expireHolds();
    expect(await orderStatus(expiredOrder.orderId)).toBe('expired');
    await expireHold(paidOrder.orderId);

    const before = await inventoryOf(date);
    vi.spyOn(store, 'findExpiredHoldIds').mockResolvedValueOnce([expiredOrder.orderId, paidOrder.orderId]);
    expect(await expiry.expireHolds()).toEqual({ expired: 0, skipped: 2, errors: 0 });
    expect(await orderStatus(paidOrder.orderId)).toBe('paid');
    expect(await inventoryOf(date)).toMatchObject({ held: before.held, sold: before.sold });
  });

  it('kết quả thất bại của lần cũ đến muộn không kéo đơn về pending khi lần mới còn sống', async () => {
    const date = addDays(TODAY_DATE, 51);
    const before = await inventoryOf(date);
    const user = newUser();
    const order = await ready(user, date);
    await startVnpay(user, order);
    const second = await startVnpay(user, order);
    const [first] = await paymentsOf(order.orderId);
    // IPN đã đọc thấy lần cũ còn initiated, khách bấm trả lại xong thì mới tới TX2: gọi thẳng để không phải canh thời gian.
    expect(await payment.applyResult(first!.gateway_key, { status: 'failed', code: 'vnpay_24' })).toMatchObject({ kind: 'failed' });
    expect(await orderStatus(order.orderId)).toBe('paying');
    expect((await paymentsOf(order.orderId))[1]!.status).toBe('initiated');
    expect((await http().get('/api/payments/vnpay/ipn').query(vnpaySuccess(second, '15000041'))).body.RspCode).toBe('00');
    expect(await orderStatus(order.orderId)).toBe('paid');
    expect(await refundsOf(order.orderId)).toHaveLength(0);
    expect((await inventoryOf(date)).sold).toBe(before.sold + 1);
  });

  it('server chết ngay sau TX2 của tiền về muộn: job vẫn tự hoàn VNPay đúng một lần', async () => {
    const date = addDays(TODAY_DATE, 39);
    const user = newUser();
    const order = await ready(user, date);
    await startVnpay(user, order);
    await expireHold(order.orderId);
    await ageCharge(order.orderId, 16);
    await expiry.expireHolds();
    const [charge] = await paymentsOf(order.orderId);
    // Chỉ chạy TX2, không có bước processRefunds phía sau.
    expect(await payment.applyResult(charge!.gateway_key, { status: 'succeeded', ref: '15000031' })).toEqual({ kind: 'compensated' });
    expect(await refundsOf(order.orderId)).toMatchObject([{ status: 'initiated', needs_review: false }]);
    await pool.query("update commerce.refunds set updated_at = now() - interval '2 minutes' where order_id = $1", [order.orderId]);
    expect((await payment.reconcile(0)).refunds).toBeGreaterThanOrEqual(1);
    expect(await refundsOf(order.orderId)).toMatchObject([{ status: 'succeeded', needs_review: false }]);
    expect((await payment.reconcile(0)).refunds).toBe(0);
    expect(await refundsOf(order.orderId)).toHaveLength(1);
  });
});
