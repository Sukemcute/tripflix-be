import { PostNotFoundException } from '../../domain/index.js';
import { PostRepository } from '../../infra/post.repository.js';
import { PostSummaryRepository } from '../../infra/post-summary.repository.js';

export interface MarkPostSummaryCheckedCommand {
  postId: string;
  /** Hash đầu vào AI vừa tính, trùng với bản đang lưu. */
  inputHash: string;
  /** Mốc AI lấy trước khi đọc dữ liệu (cùng quy ước với generatedAt). */
  checkedAt: Date;
  /** Số bình luận đang hiện của cả bài lúc kiểm. */
  commentCount: number;
}

export interface MarkPostSummaryCheckedResult {
  /** false: không có bản tóm tắt khớp inputHash, hoặc đã có lần kiểm mới hơn; AI không cần làm gì thêm. */
  updated: boolean;
}

/**
 * AI chạy lại mà đầu vào không đổi thì không lưu bản tóm tắt (khỏi gọi LLM), nên generatedAt đứng yên và
 * bình luận bị luật lọc bỏ (emoji, spam) vẫn làm bản tóm tắt bị coi là cũ mãi. Lệnh này cho AI báo
 * "đã kiểm lúc T, không có gì đổi" để core dời mốc tính isStale.
 */
export class MarkPostSummaryCheckedUseCase {
  constructor(
    private readonly postRepository: PostRepository,
    private readonly postSummaryRepository: PostSummaryRepository,
  ) {}

  async execute(command: MarkPostSummaryCheckedCommand): Promise<MarkPostSummaryCheckedResult> {
    const post = await this.postRepository.findById(command.postId);
    if (!post || post.status === 'deleted') {
      throw new PostNotFoundException(command.postId);
    }
    const updated = await this.postSummaryRepository.markChecked(command);
    return { updated };
  }
}
