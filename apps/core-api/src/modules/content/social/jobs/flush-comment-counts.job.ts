import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import type { CoreEnv } from '../../../../platform/env.js';
import { CORE_ENV } from '../../../../platform/tokens.js';
import { FLUSH_BATCH_SIZE, FlushCommentCountsUseCase } from '../application/use-cases/flush-comment-counts.use-case.js';

/** Số bình luận của bài đông chậm tối đa khoảng ngần này (TF99). */
export const FLUSH_COMMENT_COUNTS_EVERY_MS = 1_000;

/**
 * Cộng bảng đệm số bình luận vào posts.comment_count mỗi giây. Chỉ chạy khi APP_ROLE là worker hoặc all,
 * để scale API không nhân đôi job (nhiều bản worker cũng chỉ một bản cộng mỗi lượt, xem FlushCommentCountsUseCase).
 */
@Injectable()
export class FlushCommentCountsJob implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(FlushCommentCountsJob.name);
  private timer?: NodeJS.Timeout;
  private isRunning = false;

  constructor(
    @Inject(FlushCommentCountsUseCase) private readonly flushCommentCounts: FlushCommentCountsUseCase,
    @Inject(CORE_ENV) private readonly env: CoreEnv,
  ) {}

  onApplicationBootstrap() {
    if (this.env.NODE_ENV === 'test' || (this.env.APP_ROLE !== 'worker' && this.env.APP_ROLE !== 'all')) return;
    this.timer = setInterval(() => void this.run(), FLUSH_COMMENT_COUNTS_EVERY_MS);
    this.timer.unref();
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  async run(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    try {
      const result = await this.flushCommentCounts.execute();
      // Lấy đủ cả lô: bảng đệm đang dồn nhanh hơn tốc độ cộng, cần để ý.
      if (result.deltaRows >= FLUSH_BATCH_SIZE) this.logger.warn(result, 'Bảng đệm số bình luận đang dồn');
    } catch (error) {
      this.logger.error({ err: error }, 'Cộng bảng đệm số bình luận lỗi, lượt sau thử lại');
    } finally {
      this.isRunning = false;
    }
  }
}
