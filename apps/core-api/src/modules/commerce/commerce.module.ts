import { Module } from '@nestjs/common';
import { buildDrizzleToken, buildTransactionHostToken, createDb, type Db, type ModuleTransactionHost } from '@tripflix/db';
import { DrizzleIdempotencyStore, IdempotencyModule } from '@tripflix/idempotency';
import { OutboxWriter } from '@tripflix/outbox';
import { z } from 'zod';
import { DB_POOLS, type DbPools } from '../../platform/tokens.js';
import { CheckoutController } from './booking/api/checkout.controller.js';
import { CheckoutUseCases } from './booking/application/checkout.use-cases.js';
import { COMMERCE_CLOCK, ORDER_STORE, type Clock } from './booking/application/ports.js';
import { DrizzleOrderStore } from './booking/infra/drizzle-order.store.js';
import { CommerceFacade } from './commerce.facade.js';
import { commerceIdempotencyKeys, commerceOutboxEvents } from './db/schema/index.js';
import { AdminCalendarController } from './inventory/api/admin-calendar.controller.js';
import { CalendarAdminUseCases } from './inventory/application/calendar-admin.use-cases.js';
import { CalendarUseCases } from './inventory/application/calendar.use-cases.js';
import { CatalogUseCases } from './inventory/application/catalog.use-cases.js';
import { COMMERCE_STORE, TODAY, type Today } from './inventory/application/ports.js';
import { DrizzleCommerceStore } from './inventory/infra/drizzle-commerce.store.js';
import { OpenCalendarJob } from './inventory/jobs/open-calendar.job.js';
import { MockGatewayController } from './payment/api/mock-gateway.controller.js';
import { PAYMENT_GATEWAY, type PaymentGateway } from './payment/application/gateway.port.js';
import { COMMERCE_OUTBOX, PaymentUseCases } from './payment/application/payment.use-cases.js';
import { MockGateway } from './payment/infra/mock-gateway.js';
import { PaymentJobs } from './payment/jobs/payment-jobs.js';
import { VnpayCallbackController, VnpayCheckoutController } from './payment/api/vnpay.controller.js';
import { VNPAY_CONFIG, VnpayUseCases, type VnpayConfig } from './payment/application/vnpay.use-cases.js';

/** Ngày theo giờ Việt Nam: lịch trống và luật bán tính theo ngày địa phương, không theo UTC. */
const todayInVietnam: Today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());

/** VNPay sandbox: chỉ bật khi có đủ mã merchant và khoá ký; thiếu thì các endpoint VNPay trả 404. Khoá chỉ để trong .env. */
const VnpayEnvSchema = z.object({
  VNPAY_TMN_CODE: z.string().optional(),
  VNPAY_HASH_SECRET: z.string().optional(),
  VNPAY_PAYMENT_URL: z.url().default('https://sandbox.vnpayment.vn/paymentv2/vpcpay.html'),
  VNPAY_RETURN_URL: z.url().default('http://localhost:3000/api/payments/vnpay/return'),
});

function loadVnpayConfig(source: Record<string, unknown>): VnpayConfig | null {
  const env = VnpayEnvSchema.parse(source);
  if (!env.VNPAY_TMN_CODE || !env.VNPAY_HASH_SECRET) return null;
  return { tmnCode: env.VNPAY_TMN_CODE, hashSecret: env.VNPAY_HASH_SECRET, paymentUrl: env.VNPAY_PAYMENT_URL, returnUrl: env.VNPAY_RETURN_URL };
}

/**
 * Module commerce. Chủ: Thắng (backup Bảo). Xem README.md cùng thư mục.
 * Module khác chỉ dùng những gì được export trong index.ts: CommerceModule và CommerceFacade.
 * Store đọc kết nối qua TransactionHost của commerce, nên use case có @Transactional('commerce') ghi mọi thứ
 * trong cùng một transaction. Test thay store / cổng bằng overrideProvider.
 */
@Module({
  imports: [
    IdempotencyModule.forFeature({
      inject: [buildDrizzleToken('commerce')],
      useFactory: (db: Db) => new DrizzleIdempotencyStore(db, commerceIdempotencyKeys),
    }),
  ],
  controllers: [AdminCalendarController, CheckoutController, VnpayCheckoutController, VnpayCallbackController, MockGatewayController],
  providers: [
    { provide: COMMERCE_STORE, useClass: DrizzleCommerceStore },
    { provide: ORDER_STORE, useClass: DrizzleOrderStore },
    { provide: TODAY, useValue: todayInVietnam },
    { provide: COMMERCE_CLOCK, useValue: (() => new Date()) satisfies Clock },
    {
      provide: COMMERCE_OUTBOX,
      inject: [buildTransactionHostToken('commerce')],
      useFactory: (txHost: ModuleTransactionHost) => new OutboxWriter(() => txHost.tx, commerceOutboxEvents, 'core-api/commerce'),
    },
    {
      // Cổng thẻ giả lập là hệ thống ngoài: chạy trên kết nối thường, không bao giờ nằm trong transaction của commerce.
      provide: PAYMENT_GATEWAY,
      inject: [DB_POOLS],
      useFactory: (pools: DbPools): PaymentGateway => new MockGateway(createDb(pools.commerce)),
    },
    { provide: VNPAY_CONFIG, useFactory: () => loadVnpayConfig(process.env) },
    CatalogUseCases,
    CalendarUseCases,
    CalendarAdminUseCases,
    CheckoutUseCases,
    PaymentUseCases,
    VnpayUseCases,
    OpenCalendarJob,
    PaymentJobs,
    CommerceFacade,
  ],
  exports: [CommerceFacade],
})
export class CommerceModule {}

