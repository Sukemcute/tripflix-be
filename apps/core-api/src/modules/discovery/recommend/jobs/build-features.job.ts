import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import type { CoreEnv } from '../../../../platform/env.js';
import { CORE_ENV } from '../../../../platform/tokens.js';
import { BuildFeaturesUseCases } from '../application/build-features.use-cases.js';

const EVERY_MS = 10 * 60 * 1000;

/**
 * Tính đặc trưng gợi ý lúc worker khởi động và mỗi 10 phút. Chỉ chạy khi APP_ROLE là worker hoặc all.
 * ponytail: dựng lại toàn bộ mỗi chu kỳ (pilot < 1 giây); cộng dồn theo watermark + ingested_at khi lên hàng chục nghìn bài.
 */
@Injectable()
export class BuildFeaturesJob implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(BuildFeaturesJob.name);
  private timer?: NodeJS.Timeout;
  private isRunning = false;

  constructor(
    @Inject(CORE_ENV) private readonly env: CoreEnv,
    @Inject(BuildFeaturesUseCases) private readonly features: BuildFeaturesUseCases,
  ) {}

  onApplicationBootstrap() {
    if (this.env.APP_ROLE === 'api' || this.env.NODE_ENV === 'test') return;
    void this.run();
    this.timer = setInterval(() => void this.run(), EVERY_MS);
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
      const result = await this.features.runCycle();
      if (result === null) this.logger.log('Worker khác đang tính đặc trưng gợi ý (hoặc chưa có bài), bỏ lượt');
      else this.logger.log({ ...result, durationMs: Date.now() - startedAt }, `Đã tính đặc trưng gợi ý: ${result.posts} bài, ${result.users} người trong ${Date.now() - startedAt} ms`);
    } catch (error) {
      // Không chặn: endpoint vẫn chạy trên đặc trưng cũ.
      this.logger.error(`Tính đặc trưng gợi ý lỗi: ${(error as Error).message}`);
    } finally {
      this.isRunning = false;
    }
  }
}
