import { PostNotFoundException } from '../../domain/index.js';
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

  async execute(command: BookmarkPostCommand): Promise<BookmarkPostResult> {
    const post = await this.postRepository.findById(command.postId);
    if (!post || post.status === 'deleted') {
      throw new PostNotFoundException(command.postId);
    }

    const wasBookmarked = await this.bookmarkRepository.isBookmarked(command.postId, command.userId);

    // Chỉ cập nhật counter khi trạng thái thay đổi
    if (wasBookmarked !== command.isBookmarked) {
      await this.bookmarkRepository.setBookmark(command.postId, command.userId, command.isBookmarked);
      const delta = command.isBookmarked ? 1 : -1;
      await this.postRepository.incrementCounter(command.postId, 'bookmarkCount', delta);
    }

    const updatedPost = await this.postRepository.findById(command.postId);

    return {
      postId: command.postId,
      isBookmarked: command.isBookmarked,
      bookmarkCount: updatedPost?.bookmarkCount ?? 0,
    };
  }
}
