import { Transactional } from '@tripflix/db';
import { Post, PostNotFoundException } from '../../domain/index.js';
import { BookmarkRepository } from '../../infra/bookmark.repository.js';
import { PostRepository } from '../../infra/post.repository.js';

export interface BookmarkPostCommand {
  postId: string;
  userId: string;
  isBookmarked: boolean;
}

export interface BookmarkPostResult {
  postId: string;
  isBookmarked: boolean;
  bookmarkCount: number;
}

export class BookmarkPostUseCase {
  constructor(
    private readonly postRepository: PostRepository,
    private readonly bookmarkRepository: BookmarkRepository,
  ) {}

  @Transactional('content')
  async execute(command: BookmarkPostCommand): Promise<BookmarkPostResult> {
    const post = this.postRepository.findByIdForUpdate
      ? await this.postRepository.findByIdForUpdate(command.postId)
      : await this.postRepository.findById(command.postId);
    if (!post || post.status === 'deleted') {
      throw new PostNotFoundException(command.postId);
    }

    const domainPost = new Post({ ...post, coverMediaId: post.coverMediaId ?? undefined });
    if (!domainPost.canBeViewedBy(command.userId)) {
      throw new PostNotFoundException(command.postId);
    }

    // Một câu vừa ghi vừa biết trạng thái có đổi không; số mới lấy từ chính câu cộng đếm (TF99).
    const isChanged = await this.bookmarkRepository.changeBookmark(command.postId, command.userId, command.isBookmarked);
    const bookmarkCount = isChanged
      ? await this.postRepository.incrementCounter(command.postId, 'bookmarkCount', command.isBookmarked ? 1 : -1)
      : post.bookmarkCount;

    return {
      postId: command.postId,
      isBookmarked: command.isBookmarked,
      bookmarkCount: bookmarkCount ?? 0,
    };
  }
}
