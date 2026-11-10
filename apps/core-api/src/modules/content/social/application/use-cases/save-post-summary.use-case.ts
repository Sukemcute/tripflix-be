import { PostNotFoundException, InvalidCommentBodyException } from '../../domain/index.js';
import { PostRepository } from '../../infra/post.repository.js';
import { PostSummaryRepository } from '../../infra/post-summary.repository.js';
import type { PostSummaryRecord } from '../../../db/schema/index.js';

export interface SavePostSummaryCommand {
  postId: string;
  status?: string;
  summary?: string | null;
  keyTakeaways?: string[];
  content?: Record<string, unknown> | null;
  safety?: Record<string, unknown> | null;
  inputHash?: string | null;
  sourceCommentIds?: string[] | null;
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
      throw new InvalidCommentBodyException('Nội dung tóm tắt không được để trống khi trạng thái là ready');
    }

    if (!command.generatedAt || Number.isNaN(command.generatedAt.getTime())) {
      throw new InvalidCommentBodyException('generatedAt là bắt buộc và phải là thời điểm hợp lệ');
    }

    return this.postSummaryRepository.saveIfNewer({
      postId: command.postId,
      status,
      summary: summary || null,
      keyTakeaways: command.keyTakeaways ?? [],
      content: command.content ?? null,
      safety: command.safety ?? null,
      inputHash: command.inputHash ?? null,
      sourceCommentIds:
        command.sourceCommentIds === undefined || command.sourceCommentIds === null
          ? null
          : [...new Set(command.sourceCommentIds)],
      commentCountAtSummary: command.commentCount ?? 0,
      promptVersion: command.promptVersion ?? null,
      modelName: command.modelName ?? null,
      generatedAt: command.generatedAt,
    });
  }
}
