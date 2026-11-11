import { Post, PostNotFoundException } from '../../domain/index.js';
import { CommentRepository, type SampledCommentRecord } from '../../infra/comment.repository.js';
import { PostRepository } from '../../infra/post.repository.js';

export interface SampleCommentsQuery {
  postId: string;
  size?: number;
  seed?: string;
  viewerId?: string;
  isStaff?: boolean;
}

export interface SampleCommentItem {
  id: string;
  postId: string;
  authorId: string;
  body: string;
  parentCommentId: string | null;
  parentCommentBody: string | null;
  likeCount: number;
  createdAt: Date;
  editedAt: Date | null;
}

export interface SampleCommentsResult {
  stats: {
    visibleCommentCount: number;
    uniqueAuthorCount: number;
  };
  items: SampleCommentItem[];
}

const DEFAULT_SAMPLE_SIZE = 1000;
const MAX_SAMPLE_SIZE = 5000;

export class SampleCommentsUseCase {
  constructor(
    private readonly postRepository: PostRepository,
    private readonly commentRepository: CommentRepository,
  ) {}

  async execute(query: SampleCommentsQuery): Promise<SampleCommentsResult> {
    const post = await this.postRepository.findById(query.postId);
    if (!post) {
      throw new PostNotFoundException(query.postId);
    }

    const domainPost = new Post({ ...post, coverMediaId: post.coverMediaId ?? undefined });
    if (!domainPost.canBeViewedBy(query.viewerId, query.isStaff)) {
      throw new PostNotFoundException(query.postId);
    }

    const rawSize = query.size ?? DEFAULT_SAMPLE_SIZE;
    const size = Math.min(Math.max(1, Math.floor(rawSize)), MAX_SAMPLE_SIZE);

    const [stats, records] = await Promise.all([
      this.commentRepository.getCommentStats(query.postId),
      this.commentRepository.sampleComments({
        postId: query.postId,
        size,
        seed: query.seed?.trim() || undefined,
      }),
    ]);

    const items: SampleCommentItem[] = records.map((c: SampledCommentRecord) => ({
      id: c.id,
      postId: c.postId,
      authorId: c.authorId,
      body: c.body,
      parentCommentId: c.parentCommentId,
      parentCommentBody: c.parentCommentBody ?? null,
      likeCount: c.likeCount ?? 0,
      createdAt: c.createdAt,
      editedAt: c.isEdited ? (c.updatedAt ?? null) : null,
    }));

    return {
      stats,
      items,
    };
  }
}
