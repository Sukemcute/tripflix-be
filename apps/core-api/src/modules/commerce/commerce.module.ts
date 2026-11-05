import { Module } from '@nestjs/common';
import { CommerceFacade } from './commerce.facade.js';
import { AdminCalendarController } from './inventory/api/admin-calendar.controller.js';
import { HotelsController } from './inventory/api/hotels.controller.js';
import { CalendarAdminUseCases } from './inventory/application/calendar-admin.use-cases.js';
import { CalendarUseCases } from './inventory/application/calendar.use-cases.js';
import { CatalogUseCases } from './inventory/application/catalog.use-cases.js';
import { HotelDetailUseCases } from './inventory/application/hotel-detail.use-cases.js';
import type { CoreEnv } from '../../platform/env.js';
import { CORE_ENV } from '../../platform/tokens.js';
import { COMMERCE_STORE, MEDIA_URL, TODAY, keepMediaKey, type MediaUrl, type Today } from './inventory/application/ports.js';
import { DrizzleCommerceStore } from './inventory/infra/drizzle-commerce.store.js';
import { OpenCalendarJob } from './inventory/jobs/open-calendar.job.js';

/** Ngày theo giờ Việt Nam: lịch trống và luật bán tính theo ngày địa phương, không theo UTC. */
const todayInVietnam: Today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());

/** Ảnh lưu khoá đầy đủ trên S3 (có tiền tố môi trường); web và app nhận URL CloudFront. */
function buildMediaUrl(cdnBaseUrl: string | undefined): MediaUrl {
  if (!cdnBaseUrl) return keepMediaKey;
  const base = cdnBaseUrl.replace(/\/+$/, '');
  return (key) => (/^https?:\/\//.test(key) ? key : `${base}/${key.replace(/^\/+/, '')}`);
}

/**
 * Module commerce. Chủ: Thắng (backup Bảo). Xem README.md cùng thư mục.
 * Module khác chỉ dùng những gì được export trong index.ts: CommerceModule và CommerceFacade.
 * Database riêng commerce, user Postgres tf_commerce. Store đọc kết nối qua TransactionHost của commerce, nên
 * use case có @Transactional('commerce') ghi mọi thứ trong cùng một transaction. Test thay store bằng overrideProvider(COMMERCE_STORE).
 */
@Module({
  controllers: [HotelsController, AdminCalendarController],
  providers: [
    { provide: COMMERCE_STORE, useClass: DrizzleCommerceStore },
    { provide: TODAY, useValue: todayInVietnam },
    { provide: MEDIA_URL, inject: [CORE_ENV], useFactory: (env: CoreEnv) => buildMediaUrl(env.MEDIA_CDN_URL) },
    CatalogUseCases,
    HotelDetailUseCases,
    CalendarUseCases,
    CalendarAdminUseCases,
    OpenCalendarJob,
    CommerceFacade,
  ],
  exports: [CommerceFacade],
})
export class CommerceModule {}
