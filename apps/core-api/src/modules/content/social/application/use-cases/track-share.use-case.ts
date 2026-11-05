import { PostNotFoundException } from '../../domain/index.js';
import { PostRepository } from '../../infra/post.repository.js';
import { createSocialEvent } from '../events/social-events.js';
import type { EventPublisherPort } from '../ports/event-publisher.port.js';

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
    private readonly eventPublisher: EventPublisherPort,
  ) {}

  async execute(command: TrackShareCommand): Promise<TrackShareResult> {
    const post = await this.postRepository.findById(command.postId);
    if (!post || post.status === 'deleted') {
      throw new PostNotFoundException(command.postId);
    }

    await this.postRepository.incrementCounter(command.postId, 'shareCount', 1);

    const shareUrl = `https://tripflix.vn/posts/${command.postId}`;

    await this.eventPublisher.publish(
      createSocialEvent({
        type: 'content.post.shared',
        userId: command.userId ?? null,
        payload: {
          postId: command.postId,
          userId: command.userId ?? null,
          shareUrl,
        },
      }),
    );

    const updated = await this.postRepository.findById(command.postId);

    return {
      postId: command.postId,
      shareUrl,
      shareCount: updated?.shareCount ?? post.shareCount + 1,
    };
  }
}
