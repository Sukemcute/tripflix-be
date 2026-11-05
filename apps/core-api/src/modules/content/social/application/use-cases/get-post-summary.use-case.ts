import { PostNotFoundException } from '../../domain/index.js';
import { PostRepository } from '../../infra/post.repository.js';
import { PostSummaryRepository } from '../../infra/post-summary.repository.js';
import type { PostSummaryRecord } from '../../../db/schema/index.js';

export class GetPostSummaryUseCase {
  constructor(
    private readonly postRepository: PostRepository,
    private readonly postSummaryRepository: PostSummaryRepository,
  ) {}

  async execute(postId: string): Promise<PostSummaryRecord | null> {
    const post = await this.postRepository.findById(postId);
    if (!post || post.status === 'deleted') {
      throw new PostNotFoundException(postId);
    }

    return this.postSummaryRepository.findByPostId(postId);
  }
}
