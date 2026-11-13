import { Post, PostNotFoundException } from '../../domain/index.js';
import { BookmarkRepository } from '../../infra/bookmark.repository.js';
import { PostRepository } from '../../infra/post.repository.js';
import { ReactionRepository } from '../../infra/reaction.repository.js';
import { PostShareLinks } from '../post-share-links.js';
import type { UserDirectoryPort } from '../ports/user-directory.port.js';
import type {
  PostRecord,
  ReactionType,
  TripAttachmentData,
} from '../../../db/schema/index.js';

export interface GetPostDetailQuery {
  postId: string;
  viewerId?: string;
  isStaff?: boolean;
}

export interface PostDetailResult {
  post: Omit<PostRecord, 'tripAttachment'> & {
    tripAttachment: TripAttachmentData | null;
    authorName: string | null;
  };
  viewerContext: {
    myReaction: ReactionType | null;
    isBookmarked: boolean;
  };
  shareUrl: string;
}

export class GetPostDetailUseCase {
  constructor(
    private readonly postRepository: PostRepository,
    private readonly reactionRepository: ReactionRepository,
    private readonly bookmarkRepository: BookmarkRepository,
    private readonly userDirectory?: UserDirectoryPort,
    private readonly shareLinks: PostShareLinks = new PostShareLinks(),
  ) {}

  async execute(query: GetPostDetailQuery): Promise<PostDetailResult> {
    const record = await this.postRepository.findById(query.postId);
    if (!record) {
      throw new PostNotFoundException(query.postId);
    }

    const domainPost = new Post({
      id: record.id,
      authorId: record.authorId,
      postType: record.postType,
      title: record.title,
      body: record.body,
      hashtags: record.hashtags,
      status: record.status,
      visibility: record.visibility,
      isVerified: record.isVerified,
      mediaIds: record.mediaIds,
      coverMediaId: record.coverMediaId ?? undefined,
      tripAttachment: record.tripAttachment,
      reactionCounts: record.reactionCounts,
      reactionTotal: record.reactionTotal,
      commentCount: record.commentCount,
      shareCount: record.shareCount,
      bookmarkCount: record.bookmarkCount,
      publishedAt: record.publishedAt,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      deletedAt: record.deletedAt,
    });

    if (!domainPost.canBeViewedBy(query.viewerId, query.isStaff)) {
      throw new PostNotFoundException(query.postId);
    }

    let myReaction: ReactionType | null = null;
    let isBookmarked = false;

    if (query.viewerId) {
      const [reactionRecord, bookmarked] = await Promise.all([
        this.reactionRepository.findByPostAndUser(query.postId, query.viewerId),
        this.bookmarkRepository.isBookmarked(query.postId, query.viewerId),
      ]);
      myReaction = (reactionRecord?.type as ReactionType) ?? null;
      isBookmarked = bookmarked;
    }

    const maskedTrip = domainPost.getMaskedTripAttachment();

    let authorName: string | null = null;
    if (this.userDirectory) {
      try {
        const names = await this.userDirectory.getDisplayNames([record.authorId]);
        authorName = names.get(record.authorId) ?? null;
      } catch {
        authorName = null;
      }
    }

    return {
      post: {
        ...record,
        tripAttachment: maskedTrip,
        authorName,
      },
      viewerContext: {
        myReaction,
        isBookmarked,
      },
      shareUrl: this.shareLinks.buildUrl(record.id, record.postType),
    };
  }
}
