import { describe, expect, it, vi } from 'vitest';
import type { PostRecord, ReactionType } from '../../../db/schema/index.js';
import type { BookmarkRepository } from '../../infra/bookmark.repository.js';
import type { PostRepository } from '../../infra/post.repository.js';
import type { ReactionRepository } from '../../infra/reaction.repository.js';
import { ListPostsUseCase } from './list-posts.use-case.js';

const post = (id: string, extra: Partial<PostRecord> = {}) =>
  ({
    id,
    authorId: 'a1',
    postType: 'vlog',
    title: id,
    body: '',
    hashtags: [],
    status: 'published',
    visibility: 'public',
    isVerified: false,
    mediaIds: [],
    coverMediaId: null,
    tripAttachment: null,
    reactionCounts: {},
    reactionTotal: 0,
    commentCount: 0,
    shareCount: 0,
    bookmarkCount: 0,
    publishedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...extra,
  }) as unknown as PostRecord;

describe('ListPostsUseCase với ids', () => {
  it('trả đúng thứ tự ids, bỏ bài nháp, riêng tư, đã xoá, không tồn tại; kèm viewerContext một lần đọc', async () => {
    const posts = {
      findByIds: vi.fn(async () => [
        post('p3'),
        post('p1'),
        post('draft', { status: 'draft' }),
        post('private', { visibility: 'private' }),
        post('gone', { deletedAt: new Date() }),
      ]),
      findPublicPosts: vi.fn(),
    } as unknown as PostRepository;
    const reactions = {
      findByPostsAndUser: vi.fn(async () => new Map<string, ReactionType>([['p1', 'like' as ReactionType]])),
    } as unknown as ReactionRepository;
    const bookmarks = { findBookmarkedPostIds: vi.fn(async () => new Set(['p3'])) } as unknown as BookmarkRepository;

    const page = await new ListPostsUseCase(posts, undefined, reactions, bookmarks).execute({
      ids: ['p1', 'draft', 'missing', 'p3', 'private', 'gone'],
      viewerId: 'u1',
    });

    expect(page.items.map((item) => [item.id, item.viewerContext])).toEqual([
      ['p1', { myReaction: 'like', isBookmarked: false }],
      ['p3', { myReaction: null, isBookmarked: true }],
    ]);
    expect(page).toMatchObject({ nextCursor: null, hasMore: false });
    expect(posts.findPublicPosts).not.toHaveBeenCalled();
    expect(reactions.findByPostsAndUser).toHaveBeenCalledTimes(1);
  });
});
