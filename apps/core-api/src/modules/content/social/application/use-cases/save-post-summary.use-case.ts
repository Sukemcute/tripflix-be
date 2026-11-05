import { PostNotFoundException } from '../../domain/index.js';
import { PostRepository } from '../../infra/post.repository.js';
import { PostSummaryRepository } from '../../infra/post-summary.repository.js';
import type { PostSummaryRecord } from '../../../db/schema/index.js';

export interface SavePostSummaryCommand {
  postId: string;
  summary: string;
  keyTakeaways?: string[];
  inputHash?: string;
  commentCount?: number;
}

export class SavePostSummaryUseCase {
  constructor(
    private readonly postRepository: PostRepository,
    private readonly postSummaryRepository: PostSummaryRepository,
  ) {}

  async execute(command: SavePostSummaryCommand): Promise<PostSummaryRecord> {
    const post = await this.postRepository.findById(command.postId);
    if (!post || post.status === 'deleted') {
      throw new PostNotFoundException(command.postId);
    }

    const summary = (command.summary ?? '').trim();
    if (!summary) {
      throw new Error('Nội dung tóm tắt không được để trống');
    }

    return this.postSummaryRepository.upsert({
      postId: command.postId,
      summary,
      keyTakeaways: command.keyTakeaways ?? [],
      inputHash: command.inputHash ?? null,
      commentCountAtSummary: command.commentCount ?? 0,
    });
  }
}
