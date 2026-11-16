import { PostNotFoundException } from '../../domain/errors.js';
import { ModerationActionRepository } from '../../infra/moderation-action.repository.js';
import { PostRepository } from '../../infra/post.repository.js';
import type { UserDirectoryPort } from '../ports/user-directory.port.js';
import { buildFallbackDisplayName } from './list-admin-posts.use-case.js';

export interface GetAdminPostDetailQuery {
  postId: string;
}

export interface AdminModerationHistoryItem {
  action_id: string;
  action: string;
  reason_code: string;
  reason_detail: string | null;
  report_ids: string[];
  moderator_id: string;
  created_at: string;
}

export interface AdminPostDetailResult {
  id: string;
  title: string;
  body: string;
  post_type: string;
  status: string;
  visibility: string;
  is_verified: boolean;
  author: { id: string; display_name: string };
  media_ids: string[];
  cover_media_id: string | null;
  hashtags: string[];
  trip_attachment: unknown;
  reaction_counts: Record<string, number>;
  reaction_total: number;
  comment_count: number;
  share_count: number;
  bookmark_count: number;
  created_at: string;
  updated_at: string;
  moderation_history: AdminModerationHistoryItem[];
}

export class GetAdminPostDetailUseCase {
  constructor(
    private readonly postRepository: PostRepository,
    private readonly moderationRepository: ModerationActionRepository,
    private readonly userDirectory?: UserDirectoryPort,
  ) {}

  async execute(query: GetAdminPostDetailQuery): Promise<AdminPostDetailResult> {
    const post = await this.postRepository.findById(query.postId);
    if (!post) {
      throw new PostNotFoundException(query.postId);
    }

    const history = await this.moderationRepository.findByPostId(query.postId);

    let authorName: string | undefined;
    if (this.userDirectory) {
      try {
        const names = await this.userDirectory.getDisplayNames([post.authorId]);
        authorName = names.get(post.authorId);
      } catch {
        // Không tra được tên thì vẫn trả chi tiết bài, dùng tên dự phòng.
        authorName = undefined;
      }
    }

    return {
      id: post.id,
      title: post.title,
      body: post.body,
      post_type: post.postType,
      status: post.status,
      visibility: post.visibility,
      is_verified: post.isVerified,
      author: {
        id: post.authorId,
        display_name: authorName ?? buildFallbackDisplayName(post.authorId),
      },
      media_ids: post.mediaIds,
      cover_media_id: post.coverMediaId,
      hashtags: post.hashtags,
      trip_attachment: post.tripAttachment,
      reaction_counts: post.reactionCounts,
      reaction_total: post.reactionTotal,
      comment_count: post.commentCount,
      share_count: post.shareCount,
      bookmark_count: post.bookmarkCount,
      created_at: post.createdAt.toISOString(),
      updated_at: post.updatedAt.toISOString(),
      moderation_history: history.map((h) => ({
        action_id: h.id,
        action: h.action,
        reason_code: h.reasonCode,
        reason_detail: h.reasonDetail,
        report_ids: h.reportIds,
        moderator_id: h.moderatorId,
        created_at: h.createdAt.toISOString(),
      })),
    };
  }
}
