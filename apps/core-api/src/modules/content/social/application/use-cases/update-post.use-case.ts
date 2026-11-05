import { Post, PostNotFoundException } from '../../domain/index.js';
import { PostRepository } from '../../infra/post.repository.js';
import type {
  PostRecord,
  PostVisibility,
  TripAttachmentData,
} from '../../../db/schema/index.js';

export interface UpdatePostCommand {
  postId: string;
  userId: string;
  title?: string;
  body?: string;
  hashtags?: string[];
  visibility?: PostVisibility;
  mediaIds?: string[];
  coverMediaId?: string;
  tripAttachment?: TripAttachmentData | null;
}

export class UpdatePostUseCase {
  constructor(private readonly postRepository: PostRepository) {}

  async execute(command: UpdatePostCommand): Promise<PostRecord> {
    const record = await this.postRepository.findById(command.postId);
    if (!record) {
      throw new PostNotFoundException(command.postId);
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

    domainPost.update(command.userId, {
      title: command.title,
      body: command.body,
      hashtags: command.hashtags,
      visibility: command.visibility,
      mediaIds: command.mediaIds,
      coverMediaId: command.coverMediaId,
      tripAttachment: command.tripAttachment,
    });

    return this.postRepository.update(command.postId, {
      title: domainPost.title,
      body: domainPost.body,
      hashtags: domainPost.hashtags,
      visibility: domainPost.visibility,
      mediaIds: domainPost.mediaIds,
      coverMediaId: domainPost.coverMediaId,
      tripAttachment: domainPost.tripAttachment,
    });
  }
}
