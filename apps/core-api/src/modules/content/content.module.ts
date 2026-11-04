import { Module } from '@nestjs/common';
import { MediaModule } from './media/media.module.js';

/**
 * Module content. Chủ: Phong (feed, media), Thành (social), Trang (moderation). Xem README.md cùng thư mục.
 * Module khác chỉ dùng những gì được export trong index.ts.
 */
@Module({ imports: [MediaModule] })
export class ContentModule {}
