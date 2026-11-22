import { Inject, Injectable, Logger } from '@nestjs/common';
import { Transactional } from '@tripflix/db';
import type { OutboxWriter } from '@tripflix/outbox';
import { COMMERCE_OUTBOX } from '../../payment/application/payment.use-cases.js';
import { addDays } from '../../inventory/domain/sales-rules.js';
import { TODAY, type Today } from '../../inventory/application/ports.js';
import { computeTripStartAt, isDueForDepartureReminder } from '../domain/trip-status.js';
import { CheckoutUseCases } from './checkout.use-cases.js';
import { COMMERCE_CLOCK, ORDER_STORE, type Clock, type OrderItemRecord, type OrderRecord, type OrderStore } from './ports.js';

const REMINDER_BATCH = 200;

/**
 * Nhắc khách 24 giờ trước chuyến (TF37): ghi sự kiện commerce.order.departure_reminder, notification gửi email và thông báo.
 * Mỗi đơn đúng một lần: đánh dấu departure_reminded_at bằng UPDATE ... WHERE ... IS NULL và ghi outbox trong cùng transaction.
 */
@Injectable()
export class DepartureReminderUseCases {
  private readonly logger = new Logger('CommerceDepartureReminder');

  constructor(
    @Inject(ORDER_STORE) private readonly orders: OrderStore,
    @Inject(COMMERCE_CLOCK) private readonly now: Clock,
    @Inject(TODAY) private readonly today: Today,
    @Inject(CheckoutUseCases) private readonly checkout: CheckoutUseCases,
    @Inject(COMMERCE_OUTBOX) private readonly outbox: OutboxWriter,
  ) {}

  async remindDepartures(): Promise<{ reminded: number; skipped: number; errors: number }> {
    const out = { reminded: 0, skipped: 0, errors: 0 };
    const now = this.now();
    const today = this.today();
    // Hôm nay tới ngày kia (giờ Việt Nam) phủ đủ 24 giờ tới; giờ chính xác lọc lại bên dưới.
    const orderIds = await this.orders.findDepartureReminderCandidateIds({ fromDate: today, toDate: addDays(today, 2), limit: REMINDER_BATCH });
    for (const orderId of orderIds) {
      try {
        const order = await this.orders.findOrder(orderId);
        const items = await this.orders.findItems(orderId);
        const flightRoutes = await this.checkout.findFlightRoutes(items.filter((i) => i.productType === 'flight').map((i) => i.productId));
        const startAt = computeTripStartAt(items.map((i) => ({ productType: i.productType, date: i.date, departTime: flightRoutes.get(i.productId)?.departTime ?? null })));
        if (!order || !startAt || !isDueForDepartureReminder(startAt, now)) {
          out.skipped++;
          continue;
        }
        if (await this.remindOrder(order, items, flightRoutes, startAt, now)) out.reminded++;
        else out.skipped++;
      } catch (error) {
        out.errors++;
        this.logger.error({ err: error, orderId }, 'Nhắc chuyến lỗi, lượt sau thử lại');
      }
    }
    return out;
  }

  @Transactional('commerce')
  private async remindOrder(
    order: OrderRecord,
    items: OrderItemRecord[],
    flightRoutes: Awaited<ReturnType<CheckoutUseCases['findFlightRoutes']>>,
    startAt: Date,
    now: Date,
  ): Promise<boolean> {
    if (!(await this.orders.markDepartureReminded(order.id, now))) return false;
    await this.outbox.add({
      type: 'commerce.order.departure_reminder',
      userId: order.userId,
      payload: {
        orderId: order.id,
        userId: order.userId,
        startAt: startAt.toISOString(),
        confirmationCode: order.confirmationCode,
        contactName: order.contactName,
        contactEmail: order.contactEmail,
        items: items.map((i) => ({
          productType: i.productType,
          productName: i.productName,
          propertyName: i.propertyName ?? null,
          date: i.date,
          nights: i.nights,
          flight: flightRoutes.get(i.productId) ?? null,
        })),
      },
    });
    return true;
  }
}
