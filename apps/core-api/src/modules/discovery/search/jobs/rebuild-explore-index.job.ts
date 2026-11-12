import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import type { CoreEnv } from '../../../../platform/env.js';
import { CORE_ENV } from '../../../../platform/tokens.js';
import { ExploreUseCases } from '../application/explore.use-cases.js';
import { EXPLORE_INDEX_INTERVAL_MS, IndexHealth } from './index-health.js';

/**
 * Dựng lại chỉ mục tìm khám phá lúc worker khởi động và mỗi 10 phút. Chỉ chạy khi APP_ROLE là worker hoặc all.
 * ponytail: dựng lại toàn bộ (~230 mục, dưới 1 giây) thay vì cộng dồn từng bài — listPosts không báo bài bị ẩn/xoá.
 * Đổi sang cộng dồn (cursor updatedAfter + sự kiện content.post.*) khi dữ liệu lên vài chục nghìn mục.
 */
@Injectable()
export class RebuildExploreIndexJob implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(RebuildExploreIndexJob.name);
  private timer?: NodeJS.Timeout;
  private isRunning = false;

  constructor(
    @Inject(CORE_ENV) private readonly env: CoreEnv,
    @Inject(ExploreUseCases) private readonly explore: ExploreUseCases,
    @Inject(IndexHealth) private readonly health: IndexHealth,
  ) {}

  onApplicationBootstrap() {
    if (this.env.APP_ROLE === 'api' || this.env.NODE_ENV === 'test') return;
    void this.run();
    this.timer = setInterval(() => void this.run(), EXPLORE_INDEX_INTERVAL_MS);
    this.timer.unref();
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  async run() {
    if (this.isRunning) return;
    this.isRunning = true;
    const startedAt = Date.now();
    try {
      this.health.start('explore', startedAt);
      const count = await this.explore.rebuildIndex();
      this.health.finish('explore', startedAt, count === null ? 'skipped' : 'succeeded', count ?? undefined);
      if (count === null) this.logger.log('Worker khác đang dựng chỉ mục tìm khám phá, bỏ lượt');
      else this.logger.log(`Đã dựng chỉ mục tìm khám phá: ${count} mục trong ${Date.now() - startedAt} ms`);
    } catch (error) {
      this.health.finish('explore', startedAt, 'failed', undefined, error);
      // Không chặn: /search vẫn chạy trên chỉ mục cũ.
      this.logger.error(`Dựng chỉ mục tìm khám phá lỗi: ${(error as Error).message}`);
    } finally {
      this.isRunning = false;
    }
  }
}
