import { Module } from '@nestjs/common';
import { createDb } from '@tripflix/db';
import { DB_POOLS, type DbPools } from '../../platform/tokens.js';
import { CommerceFacade } from './commerce.facade.js';
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
 * Database riêng commerce, user Postgres tf_commerce; test thay store bằng overrideProvider(COMMERCE_STORE).
 */
@Module({
  providers: [
    { provide: COMMERCE_STORE, inject: [DB_POOLS], useFactory: (pools: DbPools) => new DrizzleCommerceStore(createDb(pools.commerce)) },
    { provide: TODAY, useValue: todayInVietnam },
    CatalogUseCases,
    CalendarUseCases,
    OpenCalendarJob,
    CommerceFacade,
  ],
  exports: [CommerceFacade],
})
export class CommerceModule {}
