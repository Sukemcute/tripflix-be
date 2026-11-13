import 'reflect-metadata';
import { describe, expect, it, vi, beforeEach, beforeAll } from 'vitest';
import { Test } from '@nestjs/testing';
import { ClsModule } from 'nestjs-cls';
import { createNoOpTransactionalPlugins } from '@tripflix/db';
import {
  AddCommentUseCase,
  AdminModeratePostUseCase,
  BookmarkPostUseCase,
  CreateDraftUseCase,
  DeleteCommentUseCase,
  DeletePostUseCase,
  EditCommentUseCase,
  GetAdminPostDetailUseCase,
  GetMyReactionUseCase,
  GetPostDetailUseCase,
  GetPostStatsUseCase,
  ListAdminPostsUseCase,
  ListBookmarksUseCase,
  ListPostsUseCase,
  PublishPostUseCase,
  SetReactionUseCase,
  TrackShareUseCase,
  UpdatePostUseCase,
} from '../index.js';
import type { CommerceServicePort } from '../ports/commerce-service.port.js';
import type { ContentOutbox } from '../ports/content-outbox.port.js';
import type { PostRecord, CommentRecord } from '../../../db/schema/index.js';
import {
  InvalidPostStatusTransitionException,
  InvalidReactionTypeException,
  PostMediaNotAllowedException,
  PostNotFoundException,
} from '../../domain/index.js';

describe('Social Application Use Cases', () => {
  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ClsModule.forRoot({ global: true, plugins: createNoOpTransactionalPlugins() })],
    }).compile();
    await moduleRef.init();
  });

  const authorId = '018d9f00-user-7000-8000-000000000001';
  const otherUserId = '018d9f00-user-7000-8000-000000000002';
  const moderatorId = '018d9f00-mod-7000-8000-000000000009';
  const postId = '018d9f20-post-7000-8000-000000000001';

  let mockPostRepo: any;
  let mockCommentRepo: any;
  let mockReactionRepo: any;
  let mockBookmarkRepo: any;
  let mockModerationRepo: any;
  let mockOutbox: ContentOutbox;
  let mockCommerceService: CommerceServicePort;

  function samplePostRecord(overrides: Partial<PostRecord> = {}): PostRecord {
    return {
      id: postId,
      authorId,
      postType: 'video',
      title: 'Review Phú Quốc',
      body: 'Nội dung chia sẻ...',
      hashtags: ['phuquoc'],
      status: 'draft',
      visibility: 'public',
      isVerified: false,
      mediaIds: ['media-1'],
      coverMediaId: 'media-1',
      tripAttachment: {
        bookingId: 'booking-123',
        hotelName: 'Vinpearl Phú Quốc',
        hotelId: 'hotel-001',
        destinationName: 'Phú Quốc',
        daysCount: 3,
        estimatedCostPerPerson: 3500000,
        items: [{ day: 1, title: 'Check in' }],
      },
      reactionCounts: {},
      reactionTotal: 0,
      commentCount: 0,
      shareCount: 0,
      bookmarkCount: 0,
      publishedAt: null,
      createdAt: new Date('2026-11-04T08:00:00Z'),
      updatedAt: new Date('2026-11-04T08:00:00Z'),
      deletedAt: null,
      ...overrides,
    };
  }

  beforeEach(() => {
    mockPostRepo = {
      create: vi.fn(),
      findById: vi.fn(),
      findByIds: vi.fn(),
      update: vi.fn(),
      softDelete: vi.fn(),
      findPublicPosts: vi.fn(),
      findUserPosts: vi.fn(),
      findAdminPosts: vi.fn(),
      countAdminPosts: vi.fn(),
      incrementCounter: vi.fn(),
      updateReactionCounts: vi.fn(),
    };
    mockPostRepo.findByIdForUpdate = mockPostRepo.findById;
    mockCommentRepo = {
      create: vi.fn(),
      findById: vi.fn(),
      update: vi.fn(),
      softDelete: vi.fn(),
      softDeleteWithReplies: vi.fn(),
      findByPostId: vi.fn(),
      countByPostId: vi.fn(),
    };
    mockReactionRepo = {
      upsert: vi.fn(),
      delete: vi.fn(),
      findByPostAndUser: vi.fn(),
      aggregateReactionCounts: vi.fn(),
    };
    mockBookmarkRepo = {
      setBookmark: vi.fn(),
      isBookmarked: vi.fn(),
      findUserBookmarks: vi.fn(),
      countByPostId: vi.fn(),
    };
    mockModerationRepo = {
      create: vi.fn(),
      findByPostId: vi.fn(),
    };
    mockOutbox = {
      add: vi.fn().mockResolvedValue('outbox-event-id-123'),
    };
    mockCommerceService = {
      verifyCompletedBooking: vi.fn(),
    };
  });

  describe('CreateDraftUseCase', () => {
    it('tạo bản nháp bài đăng thành công với status draft', async () => {
      const created = samplePostRecord();
      mockPostRepo.create.mockResolvedValue(created);

      const useCase = new CreateDraftUseCase(mockPostRepo);
      const result = await useCase.execute({
        authorId,
        postType: 'video',
        title: 'Review Phú Quốc',
        body: 'Nội dung chia sẻ...',
        hashtags: ['phuquoc'],
      });

      expect(result.id).toBe(postId);
      expect(mockPostRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          authorId,
          status: 'draft',
          isVerified: false,
        }),
      );
    });

    it('chặn tạo bài viết (vlog) kèm video và không ghi gì xuống DB', async () => {
      const useCase = new CreateDraftUseCase(mockPostRepo);
      await expect(
        useCase.execute({ authorId, postType: 'vlog', title: 'Bài viết', mediaIds: ['media-1'] }),
      ).rejects.toBeInstanceOf(PostMediaNotAllowedException);
      expect(mockPostRepo.create).not.toHaveBeenCalled();
    });
  });

  describe('ListBookmarksUseCase', () => {
    it('truyền bộ lọc postType xuống repository để lọc ngay trong câu truy vấn', async () => {
      mockBookmarkRepo.findUserBookmarks.mockResolvedValue([]);
      mockPostRepo.findByIds.mockResolvedValue([]);
      const useCase = new ListBookmarksUseCase(mockBookmarkRepo, mockPostRepo);
      await useCase.execute({ userId: authorId, postType: 'vlog' });
      expect(mockBookmarkRepo.findUserBookmarks).toHaveBeenCalledWith(
        expect.objectContaining({ userId: authorId, postType: 'vlog' }),
      );
    });
  });

  describe('PublishPostUseCase', () => {
    it('xuất bản thành công và gắn dấu isVerified khi đơn đã hoàn tất bên commerce', async () => {
      const post = samplePostRecord();
      mockPostRepo.findById.mockResolvedValue(post);
      mockPostRepo.update.mockResolvedValue({ ...post, status: 'published', isVerified: true });
      (mockCommerceService.verifyCompletedBooking as any).mockResolvedValue(true);

      const useCase = new PublishPostUseCase(mockPostRepo, mockOutbox, mockCommerceService);
      const result = await useCase.execute({ postId, userId: authorId });

      expect(result.status).toBe('published');
      expect(result.isVerified).toBe(true);
      expect(result.shareUrl).toBe(`https://tripflix.vn/posts/${postId}`);
      expect(mockOutbox.add).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'content.post.published',
          userId: authorId,
          payload: expect.objectContaining({
            postId,
            authorId,
            isVerified: true,
          }),
        }),
      );
    });

    it('xuất bản không có dấu isVerified nếu chuyến đi tự tạo không có booking hoàn tất', async () => {
      const post = samplePostRecord({
        tripAttachment: { destinationName: 'Đà Lạt', hotelName: 'Khách sạn X' },
      });
      mockPostRepo.findById.mockResolvedValue(post);
      mockPostRepo.update.mockResolvedValue({ ...post, status: 'published', isVerified: false });

      const useCase = new PublishPostUseCase(mockPostRepo, mockOutbox, mockCommerceService);
      const result = await useCase.execute({ postId, userId: authorId });

      expect(result.status).toBe('published');
      expect(result.isVerified).toBe(false);
    });
  });

  describe('UpdatePostUseCase & DeletePostUseCase', () => {
    it('chỉnh sửa bài đăng thành công', async () => {
      const post = samplePostRecord();
      mockPostRepo.findById.mockResolvedValue(post);
      mockPostRepo.update.mockResolvedValue({ ...post, title: 'Tiêu đề cập nhật' });

      const useCase = new UpdatePostUseCase(mockPostRepo);
      const result = await useCase.execute({
        postId,
        userId: authorId,
        title: 'Tiêu đề cập nhật',
      });

      expect(result.title).toBe('Tiêu đề cập nhật');
      expect(mockPostRepo.update).toHaveBeenCalled();
    });

    it('tự động hạ isVerified về false khi cập nhật tripAttachment', async () => {
      const verifiedPost = samplePostRecord({ isVerified: true, status: 'published' });
      mockPostRepo.findById.mockResolvedValue(verifiedPost);
      mockPostRepo.update.mockImplementation((_id: string, updateData: any) => ({
        ...verifiedPost,
        ...updateData,
      }));

      const useCase = new UpdatePostUseCase(mockPostRepo);
      const result = await useCase.execute({
        postId,
        userId: authorId,
        tripAttachment: { destinationName: 'Hà Giang mới' },
      });

      expect(result.isVerified).toBe(false);
      expect(mockPostRepo.update).toHaveBeenCalledWith(
        postId,
        expect.objectContaining({ isVerified: false }),
      );
    });

    it('phát sự kiện outbox content.post.updated khi chỉnh sửa bài viết đã xuất bản (published)', async () => {
      const publishedPost = samplePostRecord({ status: 'published' });
      mockPostRepo.findById.mockResolvedValue(publishedPost);
      mockPostRepo.update.mockResolvedValue({ ...publishedPost, title: 'Tiêu đề cập nhật mới' });

      const useCase = new UpdatePostUseCase(mockPostRepo, mockOutbox);
      await useCase.execute({
        postId,
        userId: authorId,
        title: 'Tiêu đề cập nhật mới',
      });

      expect(mockOutbox.add).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'content.post.updated',
          userId: authorId,
          payload: expect.objectContaining({
            postId,
            authorId,
            title: 'Tiêu đề cập nhật mới',
          }),
        }),
      );
    });

    it('không phát sự kiện outbox content.post.updated khi chỉnh sửa bản nháp (draft)', async () => {
      const draftPost = samplePostRecord({ status: 'draft' });
      mockPostRepo.findById.mockResolvedValue(draftPost);
      mockPostRepo.update.mockResolvedValue({ ...draftPost, title: 'Bản nháp mới' });

      const useCase = new UpdatePostUseCase(mockPostRepo, mockOutbox);
      await useCase.execute({
        postId,
        userId: authorId,
        title: 'Bản nháp mới',
      });

      expect(mockOutbox.add).not.toHaveBeenCalled();
    });

    it('xóa bài đăng thành công và ghi event outbox content.post.deleted', async () => {
      const post = samplePostRecord({ status: 'published' });
      mockPostRepo.findById.mockResolvedValue(post);
      mockPostRepo.softDelete.mockResolvedValue(undefined);

      const useCase = new DeletePostUseCase(mockPostRepo, mockOutbox);
      const result = await useCase.execute({ postId, userId: authorId });

      expect(result.deleted).toBe(true);
      expect(mockPostRepo.softDelete).toHaveBeenCalledWith(postId);
      expect(mockOutbox.add).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'content.post.deleted',
          userId: authorId,
          payload: expect.objectContaining({
            postId,
            authorId: post.authorId,
          }),
        }),
      );
    });
  });

  describe('GetPostDetailUseCase', () => {
    it('trả về chi tiết bài viết với lộ trình đã ẩn PII và kèm ngữ cảnh người xem', async () => {
      const post = samplePostRecord({ status: 'published' });
      mockPostRepo.findById.mockResolvedValue(post);
      mockReactionRepo.findByPostAndUser.mockResolvedValue({ type: 'like' });
      mockBookmarkRepo.isBookmarked.mockResolvedValue(true);

      const useCase = new GetPostDetailUseCase(mockPostRepo, mockReactionRepo, mockBookmarkRepo);

      const result = await useCase.execute({ postId, viewerId: otherUserId });

      expect(result.post.title).toBe('Review Phú Quốc');
      expect((result.post.tripAttachment as any).bookingId).toBeUndefined(); // PII bị ẩn
      expect(result.post.tripAttachment?.priceDisclaimer).toBe('Giá chỉ mang tính chất tham khảo');
      expect(result.viewerContext.myReaction).toBe('like');
      expect(result.viewerContext.isBookmarked).toBe(true);
    });

    it('gắn authorName từ userDirectory khi xem chi tiết bài viết', async () => {
      const post = samplePostRecord({ status: 'published', authorId });
      mockPostRepo.findById.mockResolvedValue(post);
      mockReactionRepo.findByPostAndUser.mockResolvedValue(null);
      mockBookmarkRepo.isBookmarked.mockResolvedValue(false);

      const mockUserDir = {
        getDisplayNames: vi.fn().mockResolvedValue(new Map([[authorId, 'Thành Lê']])),
      };

      const useCase = new GetPostDetailUseCase(mockPostRepo, mockReactionRepo, mockBookmarkRepo, mockUserDir);

      const result = await useCase.execute({ postId, viewerId: otherUserId });
      expect(result.post.authorName).toBe('Thành Lê');
      expect(mockUserDir.getDisplayNames).toHaveBeenCalledWith([authorId]);
    });
  });

  describe('ListPostsUseCase', () => {
    it('gắn authorName từ userDirectory cho từng bài viết trong danh sách', async () => {
      const post1 = samplePostRecord({ id: 'p1', authorId: 'u1' });
      const post2 = samplePostRecord({ id: 'p2', authorId: 'u2' });
      mockPostRepo.findPublicPosts.mockResolvedValue([post1, post2]);

      const mockUserDir = {
        getDisplayNames: vi.fn().mockResolvedValue(
          new Map([
            ['u1', 'Người Dùng 1'],
            ['u2', 'Người Dùng 2'],
          ]),
        ),
      };

      const useCase = new ListPostsUseCase(mockPostRepo, mockUserDir);
      const result = await useCase.execute({});

      expect(result.items).toHaveLength(2);
      expect(result.items[0]?.authorName).toBe('Người Dùng 1');
      expect(result.items[1]?.authorName).toBe('Người Dùng 2');
      expect(mockUserDir.getDisplayNames).toHaveBeenCalledWith(['u1', 'u2']);
    });

    it('gắn viewerContext chính xác khi có viewerId', async () => {
      const post1 = samplePostRecord({ id: 'p1', authorId: 'u1' });
      const post2 = samplePostRecord({ id: 'p2', authorId: 'u2' });
      mockPostRepo.findPublicPosts.mockResolvedValue([post1, post2]);

      const mockReactionRepoLocal = {
        findByPostsAndUser: vi.fn().mockResolvedValue(new Map([['p1', 'like']])),
      };
      const mockBookmarkRepoLocal = {
        findBookmarkedPostIds: vi.fn().mockResolvedValue(new Set(['p2'])),
      };

      const useCase = new ListPostsUseCase(
        mockPostRepo,
        undefined,
        mockReactionRepoLocal as any,
        mockBookmarkRepoLocal as any,
      );
      const result = await useCase.execute({ viewerId: 'user-xyz' });

      expect(result.items).toHaveLength(2);
      expect(result.items[0]?.viewerContext).toEqual({
        myReaction: 'like',
        isBookmarked: false,
      });
      expect(result.items[1]?.viewerContext).toEqual({
        myReaction: null,
        isBookmarked: true,
      });
    });
  });

  describe('SetReactionUseCase', () => {
    it('thêm cảm xúc Idempotent và cập nhật lại bộ đếm trên bài', async () => {
      const post = samplePostRecord({ status: 'published' });
      mockPostRepo.findById.mockResolvedValue(post);
      mockReactionRepo.upsert.mockResolvedValue({});
      mockReactionRepo.aggregateReactionCounts.mockResolvedValue({
        reactionCounts: { like: 1 },
        reactionTotal: 1,
      });

      const useCase = new SetReactionUseCase(mockPostRepo, mockReactionRepo, mockOutbox);

      const result = await useCase.execute({ postId, userId: otherUserId, type: 'like' });

      expect(result.myReaction).toBe('like');
      expect(result.reactionTotal).toBe(1);
      expect(mockReactionRepo.upsert).toHaveBeenCalledWith(postId, otherUserId, 'like');
      expect(mockPostRepo.updateReactionCounts).toHaveBeenCalledWith(postId, { like: 1 }, 1);
      expect(mockOutbox.add).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'content.reaction.updated',
          userId: otherUserId,
          payload: expect.objectContaining({
            postId,
            userId: otherUserId,
            postAuthorId: authorId,
            reactionTotal: 1,
          }),
        }),
      );
    });

    it('truyền type null để hủy cảm xúc', async () => {
      const post = samplePostRecord({ status: 'published' });
      mockPostRepo.findById.mockResolvedValue(post);
      mockReactionRepo.delete.mockResolvedValue(true);
      mockReactionRepo.aggregateReactionCounts.mockResolvedValue({
        reactionCounts: {},
        reactionTotal: 0,
      });

      const useCase = new SetReactionUseCase(mockPostRepo, mockReactionRepo, mockOutbox);

      const result = await useCase.execute({ postId, userId: otherUserId, type: null });

      expect(result.myReaction).toBeNull();
      expect(result.reactionTotal).toBe(0);
      expect(mockReactionRepo.delete).toHaveBeenCalledWith(postId, otherUserId);
    });
  });

  describe('Comment Use Cases', () => {
    it.each([undefined, 'parent-1'])(
      'tạo bình luận và phát outbox với parent %s',
      async (parentCommentId) => {
        const post = samplePostRecord({ status: 'published' });
        const commentRecord: CommentRecord = {
          id: 'comm-1',
          postId,
          authorId: otherUserId,
          status: 'visible',
          hiddenByActionId: null,
          cascadeRootCommentId: null,
          parentCommentId: parentCommentId ?? null,
          body: 'Bài viết hay quá!',
          likeCount: 0,
          isEdited: false,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
        };

        mockPostRepo.findById.mockResolvedValue(post);
        mockCommentRepo.create.mockResolvedValue(commentRecord);
        if (parentCommentId) {
          mockCommentRepo.findById.mockResolvedValue({
            ...commentRecord,
            id: parentCommentId,
            authorId,
            parentCommentId: null,
          });
        }

        const useCase = new AddCommentUseCase(mockPostRepo, mockCommentRepo, mockOutbox, {
          getDisplayNames: async () => new Map([[otherUserId, 'Trang']]),
        });

        const result = await useCase.execute({
          postId,
          authorId: otherUserId,
          body: 'Bài viết hay quá!',
          ...(parentCommentId ? { parentCommentId } : {}),
        });

        expect(result.id).toBe('comm-1');
        expect(mockPostRepo.incrementCounter).toHaveBeenCalledWith(postId, 'commentCount', 1);
        expect(mockOutbox.add).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'content.comment.created',
            userId: otherUserId,
            payload: expect.objectContaining({
              commentId: 'comm-1',
              postId,
              authorId: otherUserId,
              parentCommentAuthorId: parentCommentId ? authorId : null,
              authorDisplayName: 'Trang',
            }),
          }),
        );
      },
    );

    it('từ chối bình luận vào bài viết private hoặc draft của người khác (trả về PostNotFoundException)', async () => {
      const privatePost = samplePostRecord({ status: 'published', visibility: 'private', authorId });
      mockPostRepo.findById.mockResolvedValue(privatePost);

      const useCase = new AddCommentUseCase(mockPostRepo, mockCommentRepo, mockOutbox);

      await expect(
        useCase.execute({
          postId,
          authorId: otherUserId, // Người lạ cố tình comment vào bài private
          body: 'Bình luận lén',
        }),
      ).rejects.toThrow();
      expect(mockCommentRepo.create).not.toHaveBeenCalled();
    });

    it('cho phép tác giả bài viết bình luận vào bài private của chính mình', async () => {
      const privatePost = samplePostRecord({ status: 'published', visibility: 'private', authorId });
      const commentRecord: CommentRecord = {
        id: 'comm-own',
        postId,
        authorId,
        status: 'visible',
        hiddenByActionId: null,
        cascadeRootCommentId: null,
        parentCommentId: null,
        body: 'Tác giả tự bình luận',
        likeCount: 0,
        isEdited: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      };

      mockPostRepo.findById.mockResolvedValue(privatePost);
      mockCommentRepo.create.mockResolvedValue(commentRecord);

      const useCase = new AddCommentUseCase(mockPostRepo, mockCommentRepo, mockOutbox);

      const result = await useCase.execute({
        postId,
        authorId, // Chính tác giả
        body: 'Tác giả tự bình luận',
      });

      expect(result.id).toBe('comm-own');
      expect(mockCommentRepo.create).toHaveBeenCalled();
    });

    it('từ chối bình luận khi reply vào một reply khác (chặn reply cấp 2)', async () => {
      const post = samplePostRecord({ status: 'published' });
      const parentReplyRecord: CommentRecord = {
        id: 'reply-1',
        postId,
        authorId: otherUserId,
        status: 'visible',
        hiddenByActionId: null,
        cascadeRootCommentId: null,
        parentCommentId: 'root-comment-id',
        body: 'Đây là câu trả lời',
        likeCount: 0,
        isEdited: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      };

      mockPostRepo.findById.mockResolvedValue(post);
      mockCommentRepo.findById.mockResolvedValue(parentReplyRecord);

      const useCase = new AddCommentUseCase(mockPostRepo, mockCommentRepo, mockOutbox);

      await expect(
        useCase.execute({
          postId,
          authorId: otherUserId,
          body: 'Cố tình reply vào reply',
          parentCommentId: 'reply-1',
        }),
      ).rejects.toThrow(/Chỉ hỗ trợ phản hồi bình luận 1 cấp/);
    });

    it('sửa bình luận cập nhật nội dung và phát sự kiện outbox content.comment.updated', async () => {
      const commentRecord: CommentRecord = {
        id: 'comm-1',
        postId,
        authorId: otherUserId,
        status: 'visible',
        hiddenByActionId: null,
        cascadeRootCommentId: null,
        parentCommentId: null,
        body: 'Nội dung ban đầu',
        likeCount: 0,
        isEdited: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      };

      const updatedRecord: CommentRecord = {
        ...commentRecord,
        body: 'Nội dung sau khi sửa',
        isEdited: true,
        updatedAt: new Date(),
      };

      mockCommentRepo.findById.mockResolvedValue(commentRecord);
      mockCommentRepo.update.mockResolvedValue(updatedRecord);

      const useCase = new EditCommentUseCase(mockCommentRepo, mockOutbox);
      const result = await useCase.execute({
        commentId: 'comm-1',
        userId: otherUserId,
        body: 'Nội dung sau khi sửa',
      });

      expect(result.body).toBe('Nội dung sau khi sửa');
      expect(result.isEdited).toBe(true);
      expect(mockCommentRepo.update).toHaveBeenCalledWith('comm-1', {
        body: 'Nội dung sau khi sửa',
        isEdited: true,
      });
      expect(mockOutbox.add).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'content.comment.updated',
          userId: otherUserId,
          payload: expect.objectContaining({
            commentId: 'comm-1',
            postId,
            authorId: otherUserId,
            body: 'Nội dung sau khi sửa',
          }),
        }),
      );
    });

    it('xóa bình luận giảm commentCount của bài viết và phát sự kiện outbox content.comment.deleted', async () => {
      const commentRecord: CommentRecord = {
        id: 'comm-1',
        postId,
        authorId: otherUserId,
        status: 'visible',
        hiddenByActionId: null,
        cascadeRootCommentId: null,
        parentCommentId: null,
        body: 'Bình luận sắp xóa',
        likeCount: 0,
        isEdited: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      };

      mockCommentRepo.findById.mockResolvedValue(commentRecord);
      mockCommentRepo.softDeleteWithReplies.mockResolvedValue([commentRecord]);

      const useCase = new DeleteCommentUseCase(mockCommentRepo, mockPostRepo, mockOutbox);
      const result = await useCase.execute({ commentId: 'comm-1', userId: otherUserId });

      expect(result.deleted).toBe(true);
      expect(mockCommentRepo.softDeleteWithReplies).toHaveBeenCalledWith('comm-1');
      expect(mockPostRepo.incrementCounter).toHaveBeenCalledWith(postId, 'commentCount', -1);
      expect(mockOutbox.add).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'content.comment.deleted',
          userId: otherUserId,
          payload: expect.objectContaining({
            commentId: 'comm-1',
            postId,
            authorId: otherUserId,
            deletedBy: otherUserId,
            isSuperAdmin: false,
          }),
        }),
      );
    });

    it('xóa bình luận gốc cascade xóa các reply con và giảm commentCount đúng tổng số dòng bị xóa', async () => {
      const rootCommentRecord: CommentRecord = {
        id: 'comm-root',
        postId,
        authorId: otherUserId,
        status: 'visible',
        hiddenByActionId: null,
        cascadeRootCommentId: null,
        parentCommentId: null,
        body: 'Bình luận gốc có phản hồi',
        likeCount: 0,
        isEdited: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      };

      const childReply1: CommentRecord = {
        id: 'reply-1',
        postId,
        authorId: authorId,
        status: 'visible',
        hiddenByActionId: null,
        cascadeRootCommentId: null,
        parentCommentId: 'comm-root',
        body: 'Phản hồi 1',
        likeCount: 0,
        isEdited: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: new Date(),
      };

      const childReply2: CommentRecord = {
        id: 'reply-2',
        postId,
        authorId: otherUserId,
        status: 'visible',
        hiddenByActionId: null,
        cascadeRootCommentId: null,
        parentCommentId: 'comm-root',
        body: 'Phản hồi 2',
        likeCount: 0,
        isEdited: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: new Date(),
      };

      mockCommentRepo.findById.mockResolvedValue(rootCommentRecord);
      mockCommentRepo.softDeleteWithReplies.mockResolvedValue([rootCommentRecord, childReply1, childReply2]);

      const useCase = new DeleteCommentUseCase(mockCommentRepo, mockPostRepo, mockOutbox);
      const result = await useCase.execute({ commentId: 'comm-root', userId: otherUserId });

      expect(result.deleted).toBe(true);
      expect(mockCommentRepo.softDeleteWithReplies).toHaveBeenCalledWith('comm-root');
      expect(mockPostRepo.incrementCounter).toHaveBeenCalledWith(postId, 'commentCount', -3);
      expect(mockOutbox.add).toHaveBeenCalledTimes(3);
    });

    it('ném CommentNotFoundException khi xóa comment đã bị xóa hoặc không khớp (softDeleteWithReplies trả rỗng)', async () => {
      const commentRecord: CommentRecord = {
        id: 'comm-race',
        postId,
        authorId: otherUserId,
        status: 'visible',
        hiddenByActionId: null,
        cascadeRootCommentId: null,
        parentCommentId: null,
        body: 'Bình luận sắp xóa',
        likeCount: 0,
        isEdited: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      };

      mockCommentRepo.findById.mockResolvedValue(commentRecord);
      mockCommentRepo.softDeleteWithReplies.mockResolvedValue([]); // Đua lệnh: request khác đã xóa trước

      const useCase = new DeleteCommentUseCase(mockCommentRepo, mockPostRepo, mockOutbox);
      await expect(useCase.execute({ commentId: 'comm-race', userId: otherUserId })).rejects.toThrow();
      expect(mockPostRepo.incrementCounter).not.toHaveBeenCalled();
    });
  });

  describe('Bookmark & Share Use Cases', () => {
    it('bookmark bài viết tăng bookmarkCount', async () => {
      const post = samplePostRecord({ status: 'published', bookmarkCount: 5 });
      mockPostRepo.findById.mockResolvedValueOnce(post).mockResolvedValueOnce({ ...post, bookmarkCount: 6 });
      mockBookmarkRepo.isBookmarked.mockResolvedValue(false);

      const useCase = new BookmarkPostUseCase(mockPostRepo, mockBookmarkRepo);
      const result = await useCase.execute({ postId, userId: otherUserId, isBookmarked: true });

      expect(result.isBookmarked).toBe(true);
      expect(result.bookmarkCount).toBe(6);
      expect(mockBookmarkRepo.setBookmark).toHaveBeenCalledWith(postId, otherUserId, true);
      expect(mockPostRepo.incrementCounter).toHaveBeenCalledWith(postId, 'bookmarkCount', 1);
    });

    it('ghi nhận lượt chia sẻ tăng shareCount và ghi outbox content.post.shared', async () => {
      const post = samplePostRecord({ status: 'published', shareCount: 10 });
      mockPostRepo.findById.mockResolvedValueOnce(post).mockResolvedValueOnce({ ...post, shareCount: 11 });

      const useCase = new TrackShareUseCase(mockPostRepo, mockOutbox);
      const result = await useCase.execute({ postId, userId: otherUserId });

      expect(result.shareCount).toBe(11);
      expect(result.shareUrl).toBe(`https://tripflix.vn/posts/${postId}`);
      expect(mockPostRepo.incrementCounter).toHaveBeenCalledWith(postId, 'shareCount', 1);
      expect(mockOutbox.add).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'content.post.shared',
          userId: otherUserId,
          payload: expect.objectContaining({
            postId,
            userId: otherUserId,
          }),
        }),
      );
    });
  });

  describe('AdminModeratePostUseCase', () => {
    it('ẩn bài đăng, lưu nhật ký kiểm duyệt và ghi sự kiện outbox content.post.moderated', async () => {
      const post = samplePostRecord({ status: 'published' });
      mockPostRepo.findById.mockResolvedValue(post);
      mockPostRepo.update.mockResolvedValue({ ...post, status: 'hidden' });
      mockModerationRepo.create.mockResolvedValue({
        id: 'action-1',
        postId,
        moderatorId,
        action: 'hide',
        previousStatus: 'published',
        postStatus: 'hidden',
        reasonCode: 'SPAM',
        reasonDetail: 'Spam link',
        reportIds: [],
        createdAt: new Date(),
      });

      const useCase = new AdminModeratePostUseCase(mockPostRepo, mockModerationRepo, mockOutbox);

      const result = await useCase.execute({
        postId,
        moderatorId,
        action: 'hide',
        reasonCode: 'SPAM',
        reasonDetail: 'Spam link',
      });

      expect(result.actionId).toBe('action-1');
      expect(result.previousStatus).toBe('published');
      expect(result.postStatus).toBe('hidden');
      expect(mockPostRepo.update).toHaveBeenCalledWith(postId, { status: 'hidden' });
      expect(mockOutbox.add).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'content.post.moderated',
          userId: moderatorId,
          payload: expect.objectContaining({
            actionId: 'action-1',
            postId,
            previousStatus: 'published',
            postStatus: 'hidden',
          }),
        }),
      );
    });
  });

  describe('GetMyReactionUseCase', () => {
    it('trả về cảm xúc hiện tại của user trên bài viết', async () => {
      mockReactionRepo.findByPostAndUser.mockResolvedValue({ type: 'heart' });
      const useCase = new GetMyReactionUseCase(mockReactionRepo);
      const res = await useCase.execute({ postId, userId: authorId });
      expect(res).toEqual({ postId, type: 'heart' });
      expect(mockReactionRepo.findByPostAndUser).toHaveBeenCalledWith(postId, authorId);
    });

    it('trả về null nếu user chưa tương tác cảm xúc', async () => {
      mockReactionRepo.findByPostAndUser.mockResolvedValue(null);
      const useCase = new GetMyReactionUseCase(mockReactionRepo);
      const res = await useCase.execute({ postId, userId: authorId });
      expect(res).toEqual({ postId, type: null });
    });
  });

  describe('ListAdminPostsUseCase', () => {
    it('lấy danh sách bài đăng admin kèm phân trang và tổng số', async () => {
      const post = samplePostRecord({ status: 'published' });
      mockPostRepo.findAdminPosts.mockResolvedValue([post]);
      mockPostRepo.countAdminPosts.mockResolvedValue(1);

      const useCase = new ListAdminPostsUseCase(mockPostRepo);
      const res = await useCase.execute({ limit: 10, status: 'published' });

      expect(res.items.length).toBe(1);
      expect(res.total).toBe(1);
      expect(res.items[0]!.id).toBe(postId);
      expect(mockPostRepo.findAdminPosts).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 11, status: 'published' }),
      );
    });
  });

  describe('GetAdminPostDetailUseCase', () => {
    it('lấy chi tiết bài đăng kèm lịch sử kiểm duyệt', async () => {
      const post = samplePostRecord({ status: 'published' });
      mockPostRepo.findById.mockResolvedValue(post);
      mockModerationRepo.findByPostId.mockResolvedValue([
        {
          id: 'action-1',
          postId,
          moderatorId,
          action: 'hide',
          reasonCode: 'SPAM',
          reasonDetail: null,
          reportIds: [],
          createdAt: new Date('2026-11-04T08:30:00Z'),
        },
      ]);

      const useCase = new GetAdminPostDetailUseCase(mockPostRepo, mockModerationRepo);
      const res = await useCase.execute({ postId });

      expect(res.id).toBe(postId);
      expect(res.moderation_history.length).toBe(1);
      expect(res.moderation_history[0]!.action).toBe('hide');
    });

    it('ném lỗi PostNotFoundException khi không tìm thấy bài viết', async () => {
      mockPostRepo.findById.mockResolvedValue(null);
      const useCase = new GetAdminPostDetailUseCase(mockPostRepo, mockModerationRepo);
      await expect(useCase.execute({ postId: 'non-existent' })).rejects.toThrow();
    });
  });
  describe('Bảo vệ quyền riêng tư khi tương tác (TF25)', () => {
    const privatePost = () => samplePostRecord({ status: 'published', visibility: 'private' });

    it('thống kê bài riêng tư: người lạ nhận 404, tác giả và staff vẫn xem được', async () => {
      mockPostRepo.findById.mockResolvedValue(privatePost());
      const useCase = new GetPostStatsUseCase(mockPostRepo);

      await expect(useCase.execute({ postId, viewerId: otherUserId })).rejects.toBeInstanceOf(
        PostNotFoundException,
      );
      await expect(useCase.execute({ postId })).rejects.toBeInstanceOf(PostNotFoundException);
      await expect(useCase.execute({ postId, viewerId: authorId })).resolves.toMatchObject({ postId });
      await expect(useCase.execute({ postId, viewerId: moderatorId, isStaff: true })).resolves.toMatchObject({
        postId,
      });
    });

    it('thống kê bài đã ẩn: khách nhận 404 như bài không tồn tại', async () => {
      mockPostRepo.findById.mockResolvedValue(samplePostRecord({ status: 'hidden' }));
      const useCase = new GetPostStatsUseCase(mockPostRepo);
      await expect(useCase.execute({ postId })).rejects.toBeInstanceOf(PostNotFoundException);
    });

    it('thả cảm xúc vào bài riêng tư của người khác bị 404 và không ghi gì', async () => {
      mockPostRepo.findById.mockResolvedValue(privatePost());
      const useCase = new SetReactionUseCase(mockPostRepo, mockReactionRepo, mockOutbox);

      await expect(useCase.execute({ postId, userId: otherUserId, type: 'like' })).rejects.toBeInstanceOf(
        PostNotFoundException,
      );
      expect(mockReactionRepo.upsert).not.toHaveBeenCalled();
      expect(mockOutbox.add).not.toHaveBeenCalled();
    });

    it('loại cảm xúc lạ bị từ chối bằng lỗi loại cảm xúc, không ghi xuống DB', async () => {
      mockPostRepo.findById.mockResolvedValue(samplePostRecord({ status: 'published' }));
      const useCase = new SetReactionUseCase(mockPostRepo, mockReactionRepo, mockOutbox);

      await expect(
        useCase.execute({ postId, userId: otherUserId, type: 'angry' as never }),
      ).rejects.toBeInstanceOf(InvalidReactionTypeException);
      expect(mockReactionRepo.upsert).not.toHaveBeenCalled();
    });

    it('lưu bài đã ẩn bị 404 và không đổi bộ đếm', async () => {
      mockPostRepo.findById.mockResolvedValue(samplePostRecord({ status: 'hidden' }));
      const useCase = new BookmarkPostUseCase(mockPostRepo, mockBookmarkRepo);

      await expect(
        useCase.execute({ postId, userId: otherUserId, isBookmarked: true }),
      ).rejects.toBeInstanceOf(PostNotFoundException);
      expect(mockBookmarkRepo.setBookmark).not.toHaveBeenCalled();
      expect(mockPostRepo.incrementCounter).not.toHaveBeenCalled();
    });

    it('danh sách bài công khai không lộ bookingId trong lộ trình', async () => {
      mockPostRepo.findPublicPosts.mockResolvedValue([samplePostRecord({ status: 'published' })]);
      const useCase = new ListPostsUseCase(mockPostRepo);

      const result = await useCase.execute({});

      expect(result.items[0]?.tripAttachment).not.toHaveProperty('bookingId');
      expect(result.items[0]?.tripAttachment?.hotelName).toBe('Vinpearl Phú Quốc');
    });

    it('danh sách đã lưu bỏ bài riêng tư của người khác, giữ bài riêng tư của chính mình và ẩn bookingId', async () => {
      const foreignPrivate = samplePostRecord({
        id: 'foreign',
        authorId: otherUserId,
        status: 'published',
        visibility: 'private',
      });
      const ownPrivate = samplePostRecord({ id: 'own', status: 'published', visibility: 'private' });
      mockBookmarkRepo.findUserBookmarks.mockResolvedValue([
        { id: 'b1', postId: 'foreign', userId: authorId, createdAt: new Date() },
        { id: 'b2', postId: 'own', userId: authorId, createdAt: new Date() },
      ]);
      mockPostRepo.findByIds.mockResolvedValue([foreignPrivate, ownPrivate]);
      const useCase = new ListBookmarksUseCase(mockBookmarkRepo, mockPostRepo);

      const result = await useCase.execute({ userId: authorId });

      expect(result.items.map((item) => item.id)).toEqual(['own']);
      expect(result.items[0]?.tripAttachment).not.toHaveProperty('bookingId');
    });

    it('hai lượt xuất bản cùng lúc: lượt sau thấy bài đã đăng trong khoá dòng thì báo xung đột, không đăng lại', async () => {
      const draft = samplePostRecord();
      mockPostRepo.findById.mockResolvedValue(draft);
      mockPostRepo.findByIdForUpdate = vi.fn().mockResolvedValue({ ...draft, status: 'published' });
      const useCase = new PublishPostUseCase(mockPostRepo, mockOutbox, mockCommerceService);

      await expect(useCase.execute({ postId, userId: authorId })).rejects.toBeInstanceOf(
        InvalidPostStatusTransitionException,
      );
      expect(mockPostRepo.update).not.toHaveBeenCalled();
      expect(mockOutbox.add).not.toHaveBeenCalled();
    });
  });
});
