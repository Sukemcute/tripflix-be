import { PostNotFoundException } from '../../domain/index.js';
import { PostRepository } from '../../infra/post.repository.js';
import { PostSummaryRepository } from '../../infra/post-summary.repository.js';
import type { PostSummaryRecord } from '../../../db/schema/index.js';

export interface SavePostSummaryCommand {
  postId: string;
  status?: string;
  summary?: string | null;
  keyTakeaways?: string[];
  content?: unknown;
  safety?: unknown;
  inputHash?: string | null;
  commentCount?: number;
  promptVersion?: string | null;
  modelName?: string | null;
  generatedAt?: Date | null;
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

    const status = command.status ?? 'ready';
    const summary = (command.summary ?? '').trim();
    if (status === 'ready' && !summary) {
      throw new Error('Nội dung tóm tắt không được để trống khi trạng thái là ready');
    }

    return this.postSummaryRepository.upsert({
      postId: command.postId,
      status,
      summary: summary || null,
      keyTakeaways: command.keyTakeaways ?? [],
      content: (command.content as any) ?? null,
      safety: (command.safety as any) ?? null,
      inputHash: command.inputHash ?? null,
      commentCountAtSummary: command.commentCount ?? 0,
      promptVersion: command.promptVersion ?? null,
      modelName: command.modelName ?? null,
      generatedAt: command.generatedAt ?? null,
    });
  }
}
