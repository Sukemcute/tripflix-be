import { PostSummaryRepository } from '../../infra/post-summary.repository.js';

export interface ReconcileHeldSummariesQuery {
  limit?: number;
  cursor?: string;
}

export interface ReconcileHeldSummariesResult {
  postIds: string[];
  nextCursor: string | null;
  total: number;
}

export class ReconcileHeldSummariesUseCase {
  constructor(private readonly postSummaryRepository: PostSummaryRepository) {}

  async execute(query: ReconcileHeldSummariesQuery = {}): Promise<ReconcileHeldSummariesResult> {
    const limit = query.limit && query.limit > 0 ? Math.min(query.limit, 200) : 50;
    const { postIds, nextCursor } = await this.postSummaryRepository.findHeldSummaryPostIds({
      limit,
      cursor: query.cursor,
    });

    return {
      postIds,
      nextCursor,
      total: postIds.length,
    };
  }
}
