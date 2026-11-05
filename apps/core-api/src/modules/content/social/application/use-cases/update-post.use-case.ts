import { Transactional } from '@tripflix/db';
import { Post, PostNotFoundException } from '../../domain/index.js';
import { PostRepository } from '../../infra/post.repository.js';
import type {
  NewPostRecord,
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

  @Transactional('content')
  async execute(command: UpdatePostCommand): Promise<PostRecord> {
    const record = this.postRepository.findByIdForUpdate
      ? await this.postRepository.findByIdForUpdate(command.postId)
      : await this.postRepository.findById(command.postId);
    if (!record || record.deletedAt) {
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

    const patch: Partial<NewPostRecord> = {};
    if (command.title !== undefined) patch.title = domainPost.title;
    if (command.body !== undefined) patch.body = domainPost.body;
    if (command.hashtags !== undefined) patch.hashtags = domainPost.hashtags;
    if (command.visibility !== undefined) patch.visibility = domainPost.visibility;
    if (command.mediaIds !== undefined) patch.mediaIds = domainPost.mediaIds;
    if (command.coverMediaId !== undefined) patch.coverMediaId = domainPost.coverMediaId;
    if (command.tripAttachment !== undefined) {
      patch.tripAttachment = domainPost.tripAttachment;
      patch.isVerified = domainPost.isVerified;
    }

    return this.postRepository.update(command.postId, patch);
  }
}
