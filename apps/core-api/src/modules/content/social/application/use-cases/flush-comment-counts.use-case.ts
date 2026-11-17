import { Transactional } from '@tripflix/db';
import type { FlushedCounterDeltas, PostCounterDeltaRepository } from '../../infra/post-counter-delta.repository.js';

/** Mỗi lượt cộng tối đa ngần này dòng đệm; còn nữa thì lượt sau (1 giây sau) cộng tiếp. */
export const FLUSH_BATCH_SIZE = 5_000;

/** Cộng bảng đệm số bình luận của bài đông vào posts.comment_count (TF99). Bản worker khác đang cộng thì bỏ qua. */
export class FlushCommentCountsUseCase {
  constructor(private readonly counterDeltas: PostCounterDeltaRepository) {}

  @Transactional('content')
  async execute(): Promise<FlushedCounterDeltas & { isSkipped: boolean }> {
    if (!(await this.counterDeltas.tryAcquireFlushLock())) return { deltaRows: 0, postCount: 0, isSkipped: true };
    return { ...(await this.counterDeltas.flushCommentDeltas(FLUSH_BATCH_SIZE)), isSkipped: false };
  }
}
