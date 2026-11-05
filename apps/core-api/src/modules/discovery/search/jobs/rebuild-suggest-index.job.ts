import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import type { CoreEnv } from '../../../../platform/env.js';
import { CORE_ENV } from '../../../../platform/tokens.js';
import { SuggestUseCases } from '../application/suggest.use-cases.js';

/**
 * Dựng lại chỉ mục gợi ý mỗi lần worker khởi động (vài trăm dòng, dưới một giây).
 * ponytail: chưa có sự kiện commerce.ari.updated nên khách sạn mới chỉ vào gợi ý sau lần khởi động kế tiếp;
 * thêm consumer khi commerce phát sự kiện.
 */
@Injectable()
export class RebuildSuggestIndexJob implements OnApplicationBootstrap {
  private readonly logger = new Logger(RebuildSuggestIndexJob.name);

  constructor(
    @Inject(CORE_ENV) private readonly env: CoreEnv,
    @Inject(SuggestUseCases) private readonly suggestions: SuggestUseCases,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.env.APP_ROLE === 'api') return;
    const startedAt = Date.now();
    try {
      const count = await this.suggestions.rebuildIndex();
      this.logger.log(`Đã dựng chỉ mục gợi ý: ${count} dòng trong ${Date.now() - startedAt} ms`);
    } catch (error) {
      // Không chặn khởi động: /suggest vẫn chạy trên chỉ mục cũ.
      this.logger.error(`Dựng chỉ mục gợi ý lỗi: ${(error as Error).message}`);
    }
  }
}
