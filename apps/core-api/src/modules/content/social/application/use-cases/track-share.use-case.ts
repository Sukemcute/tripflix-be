import { Transactional } from '@tripflix/db';
import { PostNotFoundException } from '../../domain/index.js';
import { PostRepository } from '../../infra/post.repository.js';
import { PostShareLinks } from '../post-share-links.js';
import type { ContentOutbox } from '../ports/content-outbox.port.js';

export interface TrackShareCommand {
  postId: string;
  userId?: string;
}

export interface TrackShareResult {
  postId: string;
  shareUrl: string;
  shareCount: number;
}

export class TrackShareUseCase {
  constructor(
    private readonly postRepository: PostRepository,
    private readonly outbox: ContentOutbox,
    private readonly shareLinks: PostShareLinks = new PostShareLinks(),
  ) {}

  @Transactional('content')
  async execute(command: TrackShareCommand): Promise<TrackShareResult> {
    const post = await this.postRepository.findById(command.postId);
    if (!post || post.status === 'deleted') {
      throw new PostNotFoundException(command.postId);
    }

    await this.postRepository.incrementCounter(command.postId, 'shareCount', 1);

    const shareUrl = this.shareLinks.buildUrl(post.id, post.postType);

    // Ghi sự kiện outbox content.post.shared trong cùng transaction DB
    await this.outbox.add({
      type: 'content.post.shared',
      userId: command.userId ?? null,
      payload: {
        postId: command.postId,
        userId: command.userId ?? null,
        shareUrl,
      },
    });

    const updated = await this.postRepository.findById(command.postId);

    return {
      postId: command.postId,
      shareUrl,
      shareCount: updated?.shareCount ?? post.shareCount + 1,
    };
  }
}
