import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  AdminPostsController,
  BookmarksController,
  CommentsController,
  PostsController,
  ReactionsController,
} from './index.js';

describe('Social API Controllers', () => {
  const mockUser = { id: '018d9f00-user-7000-8000-000000000001', role: 'member' };
  const mockAdmin = { id: '018d9f00-mod-7000-8000-000000000099', role: 'moderator' };

  describe('PostsController', () => {
    const mockCreateDraft = { execute: vi.fn().mockResolvedValue({ id: 'p1', status: 'draft' }) };
    const mockUpdatePost = { execute: vi.fn().mockResolvedValue({ id: 'p1', title: 'updated' }) };
    const mockPublishPost = { execute: vi.fn().mockResolvedValue({ id: 'p1', status: 'published' }) };
    const mockDeletePost = { execute: vi.fn().mockResolvedValue({ success: true }) };
    const mockGetPostDetail = { execute: vi.fn().mockResolvedValue({ id: 'p1', title: 'Post 1' }) };
    const mockListPosts = { execute: vi.fn().mockResolvedValue({ items: [], next_cursor: null }) };
    const mockListUserPosts = { execute: vi.fn().mockResolvedValue({ items: [], next_cursor: null }) };
    const mockTrackShare = { execute: vi.fn().mockResolvedValue({ share_url: 'https://...', share_count: 1 }) };

    const controller = new PostsController(
      mockCreateDraft as any,
      mockUpdatePost as any,
      mockPublishPost as any,
      mockDeletePost as any,
      mockGetPostDetail as any,
      mockListPosts as any,
      mockListUserPosts as any,
      mockTrackShare as any,
    );

    it('createDraft nên gọi createDraftUseCase', async () => {
      const res = await controller.createDraft(mockUser, {
        post_type: 'vlog',
        title: 'Draft 1',
        media_ids: ['m1'],
      });
      expect(mockCreateDraft.execute).toHaveBeenCalledWith(
        expect.objectContaining({ authorId: mockUser.id, title: 'Draft 1' }),
      );
      expect(res).toEqual({ id: 'p1', status: 'draft' });
    });

    it('updatePost nên gọi updatePostUseCase', async () => {
      const res = await controller.updatePost('p1', mockUser, { title: 'New title' });
      expect(mockUpdatePost.execute).toHaveBeenCalledWith(
        expect.objectContaining({ postId: 'p1', userId: mockUser.id, title: 'New title' }),
      );
      expect(res).toEqual({ id: 'p1', title: 'updated' });
    });

    it('publishPost nên gọi publishPostUseCase', async () => {
      const res = await controller.publishPost('p1', mockUser);
      expect(mockPublishPost.execute).toHaveBeenCalledWith({ postId: 'p1', userId: mockUser.id });
      expect(res).toEqual({ id: 'p1', status: 'published' });
    });

    it('deletePost nên gọi deletePostUseCase', async () => {
      const res = await controller.deletePost('p1', mockUser);
      expect(mockDeletePost.execute).toHaveBeenCalledWith({
        postId: 'p1',
        userId: mockUser.id,
        isSuperAdmin: false,
      });
      expect(res).toEqual({ success: true });
    });

    it('getPostDetail nên gọi getPostDetailUseCase', async () => {
      const res = await controller.getPostDetail('p1', mockUser);
      expect(mockGetPostDetail.execute).toHaveBeenCalledWith({
        postId: 'p1',
        viewerId: mockUser.id,
        isStaff: false,
      });
      expect(res).toEqual({ id: 'p1', title: 'Post 1' });
    });

    it('listPublicPosts nên gọi listPostsUseCase', async () => {
      await controller.listPublicPosts({ limit: 10, hashtag: 'travel' });
      expect(mockListPosts.execute).toHaveBeenCalledWith({
        limit: 10,
        cursor: undefined,
        postType: undefined,
        hashtag: 'travel',
        keyword: undefined,
        authorId: undefined,
      });
    });

    it('trackShare nên gọi trackShareUseCase', async () => {
      const res = await controller.trackShare('p1', mockUser);
      expect(mockTrackShare.execute).toHaveBeenCalledWith({
        postId: 'p1',
        userId: mockUser.id,
      });
      expect(res).toEqual({ share_url: 'https://...', share_count: 1 });
    });
  });

  describe('ReactionsController', () => {
    const mockSetReaction = { execute: vi.fn().mockResolvedValue({ post_id: 'p1', reaction_type: 'like' }) };
    const mockGetStats = { execute: vi.fn().mockResolvedValue({ reaction_total: 10 }) };
    const mockReactionRepo = { findByPostAndUser: vi.fn().mockResolvedValue({ type: 'like' }) };

    const controller = new ReactionsController(
      mockSetReaction as any,
      mockGetStats as any,
      mockReactionRepo as any,
    );

    it('setReaction nên gọi setReactionUseCase', async () => {
      const res = await controller.setReaction('p1', mockUser, { type: 'like' });
      expect(mockSetReaction.execute).toHaveBeenCalledWith({
        postId: 'p1',
        userId: mockUser.id,
        type: 'like',
      });
      expect(res).toEqual({ post_id: 'p1', reaction_type: 'like' });
    });

    it('getStats nên gọi getPostStatsUseCase', async () => {
      const res = await controller.getStats('p1');
      expect(mockGetStats.execute).toHaveBeenCalledWith({ postId: 'p1' });
      expect(res).toEqual({ reaction_total: 10 });
    });

    it('getMyReaction nên lấy cảm xúc từ repository', async () => {
      const res = await controller.getMyReaction('p1', mockUser);
      expect(mockReactionRepo.findByPostAndUser).toHaveBeenCalledWith('p1', mockUser.id);
      expect(res).toEqual({ post_id: 'p1', type: 'like' });
    });
  });

  describe('CommentsController', () => {
    const mockAddComment = { execute: vi.fn().mockResolvedValue({ id: 'c1', body: 'Tuyet voi' }) };
    const mockEditComment = { execute: vi.fn().mockResolvedValue({ id: 'c1', body: 'Updated' }) };
    const mockDeleteComment = { execute: vi.fn().mockResolvedValue({ success: true }) };
    const mockListComments = { execute: vi.fn().mockResolvedValue({ items: [], next_cursor: null }) };

    const controller = new CommentsController(
      mockAddComment as any,
      mockEditComment as any,
      mockDeleteComment as any,
      mockListComments as any,
    );

    it('createComment nên gọi addCommentUseCase', async () => {
      const res = await controller.createComment('p1', mockUser, { body: 'Tuyet voi' });
      expect(mockAddComment.execute).toHaveBeenCalledWith({
        postId: 'p1',
        authorId: mockUser.id,
        body: 'Tuyet voi',
        parentCommentId: undefined,
      });
      expect(res).toEqual({ id: 'c1', body: 'Tuyet voi' });
    });

    it('editComment nên gọi editCommentUseCase', async () => {
      const res = await controller.editComment('c1', mockUser, { body: 'Updated' });
      expect(mockEditComment.execute).toHaveBeenCalledWith({
        commentId: 'c1',
        userId: mockUser.id,
        body: 'Updated',
      });
      expect(res).toEqual({ id: 'c1', body: 'Updated' });
    });

    it('deleteComment nên gọi deleteCommentUseCase', async () => {
      const res = await controller.deleteComment('c1', mockUser);
      expect(mockDeleteComment.execute).toHaveBeenCalledWith({
        commentId: 'c1',
        userId: mockUser.id,
        isSuperAdmin: false,
      });
      expect(res).toEqual({ success: true });
    });

    it('listComments nên gọi listCommentsUseCase', async () => {
      await controller.listComments('p1', { limit: 15 });
      expect(mockListComments.execute).toHaveBeenCalledWith({
        postId: 'p1',
        limit: 15,
        cursor: undefined,
        parentCommentId: undefined,
      });
    });
  });

  describe('BookmarksController', () => {
    const mockBookmark = { execute: vi.fn().mockResolvedValue({ post_id: 'p1', is_bookmarked: true }) };
    const mockListBookmarks = { execute: vi.fn().mockResolvedValue({ items: [], next_cursor: null }) };

    const controller = new BookmarksController(mockBookmark as any, mockListBookmarks as any);

    it('setBookmark nên gọi bookmarkPostUseCase', async () => {
      const res = await controller.setBookmark('p1', mockUser, { is_bookmarked: true });
      expect(mockBookmark.execute).toHaveBeenCalledWith({
        postId: 'p1',
        userId: mockUser.id,
        isBookmarked: true,
      });
      expect(res).toEqual({ post_id: 'p1', is_bookmarked: true });
    });

    it('listMyBookmarks nên gọi listBookmarksUseCase', async () => {
      await controller.listMyBookmarks(mockUser, { limit: 20 });
      expect(mockListBookmarks.execute).toHaveBeenCalledWith({
        userId: mockUser.id,
        limit: 20,
        cursor: undefined,
      });
    });
  });

  describe('AdminPostsController', () => {
    const mockPostRepo = {
      findAdminPosts: vi.fn().mockResolvedValue([
        {
          id: 'p1',
          authorId: 'u1',
          title: 'Post 1',
          postType: 'reels',
          status: 'published',
          visibility: 'public',
          reactionTotal: 5,
          commentCount: 2,
          createdAt: new Date('2026-11-04T08:00:00.000Z'),
        },
      ]),
      countAdminPosts: vi.fn().mockResolvedValue(1),
      findById: vi.fn().mockResolvedValue({
        id: 'p1',
        authorId: 'u1',
        title: 'Post 1',
        body: 'Body 1',
        postType: 'reels',
        status: 'published',
        visibility: 'public',
        isVerified: true,
        mediaIds: ['m1'],
        coverMediaId: null,
        hashtags: ['vlog'],
        tripAttachment: null,
        reactionCounts: {},
        reactionTotal: 5,
        commentCount: 2,
        shareCount: 1,
        bookmarkCount: 0,
        createdAt: new Date('2026-11-04T08:00:00.000Z'),
        updatedAt: new Date('2026-11-04T08:00:00.000Z'),
      }),
    };
    const mockModerationRepo = {
      findByPostId: vi.fn().mockResolvedValue([
        {
          id: 'act1',
          postId: 'p1',
          action: 'hide',
          reasonCode: 'SPAM',
          reasonDetail: 'Spam link',
          reportIds: [],
          moderatorId: 'mod1',
          createdAt: new Date('2026-11-04T08:30:00.000Z'),
        },
      ]),
    };
    const mockAdminModeratePost = {
      execute: vi.fn().mockResolvedValue({
        actionId: 'act1',
        postId: 'p1',
        previousStatus: 'published',
        postStatus: 'hidden',
        moderatorId: mockAdmin.id,
        createdAt: new Date(),
      }),
    };

    const controller = new AdminPostsController(
      mockPostRepo as any,
      mockModerationRepo as any,
      mockAdminModeratePost as any,
    );

    it('từ chối khi user không phải moderator/admin (ForbiddenException)', async () => {
      await expect(controller.listAdminPosts(mockUser, {})).rejects.toThrow(ForbiddenException);
      await expect(controller.getAdminPostDetail(mockUser, 'p1')).rejects.toThrow(ForbiddenException);
      await expect(
        controller.moderatePost(mockUser, 'p1', { action: 'hide', reason_code: 'SPAM' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('listAdminPosts thành công với moderator', async () => {
      const res = await controller.listAdminPosts(mockAdmin, { limit: 10 });
      expect(mockPostRepo.findAdminPosts).toHaveBeenCalled();
      expect(res.items.length).toBe(1);
      expect(res.total).toBe(1);
    });

    it('getAdminPostDetail thành công và trả về lịch sử kiểm duyệt', async () => {
      const res = await controller.getAdminPostDetail(mockAdmin, 'p1');
      expect(mockPostRepo.findById).toHaveBeenCalledWith('p1');
      expect(mockModerationRepo.findByPostId).toHaveBeenCalledWith('p1');
      expect(res.id).toBe('p1');
      expect(res.moderation_history.length).toBe(1);
    });

    it('getAdminPostDetail ném NotFoundException nếu bài viết không tồn tại', async () => {
      mockPostRepo.findById.mockResolvedValueOnce(null);
      await expect(controller.getAdminPostDetail(mockAdmin, 'non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('moderatePost thành công với moderator', async () => {
      const res = await controller.moderatePost(mockAdmin, 'p1', {
        action: 'hide',
        reason_code: 'COMMUNITY_VIOLATION',
      });
      expect(mockAdminModeratePost.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          postId: 'p1',
          moderatorId: mockAdmin.id,
          action: 'hide',
          reasonCode: 'COMMUNITY_VIOLATION',
        }),
      );
      expect(res.postStatus).toBe('hidden');
    });
  });
});
