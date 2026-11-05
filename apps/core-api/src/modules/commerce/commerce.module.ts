import { Module } from '@nestjs/common';
import { CommerceFacade } from './commerce.facade.js';
import { AdminCalendarController } from './inventory/api/admin-calendar.controller.js';
import { CalendarAdminUseCases } from './inventory/application/calendar-admin.use-cases.js';
import { CalendarUseCases } from './inventory/application/calendar.use-cases.js';
import { CatalogUseCases } from './inventory/application/catalog.use-cases.js';
import { COMMERCE_STORE, TODAY, type Today } from './inventory/application/ports.js';
import { DrizzleCommerceStore } from './inventory/infra/drizzle-commerce.store.js';
import { OpenCalendarJob } from './inventory/jobs/open-calendar.job.js';

/** Ngày theo giờ Việt Nam: lịch trống và luật bán tính theo ngày địa phương, không theo UTC. */
const todayInVietnam: Today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());

/**
 * Module commerce. Chủ: Thắng (backup Bảo). Xem README.md cùng thư mục.
 * Module khác chỉ dùng những gì được export trong index.ts: CommerceModule và CommerceFacade.
 * Database riêng commerce, user Postgres tf_commerce. Store đọc kết nối qua TransactionHost của commerce, nên
 * use case có @Transactional('commerce') ghi mọi thứ trong cùng một transaction. Test thay store bằng overrideProvider(COMMERCE_STORE).
 */
@Module({
  controllers: [AdminCalendarController],
  providers: [
    { provide: COMMERCE_STORE, useClass: DrizzleCommerceStore },
    { provide: TODAY, useValue: todayInVietnam },
    CatalogUseCases,
    CalendarUseCases,
    CalendarAdminUseCases,
    OpenCalendarJob,
    CommerceFacade,
  ],
  exports: [CommerceFacade],
})
export class CommerceModule {}
