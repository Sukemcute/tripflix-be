import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  AddCommentUseCase,
  AdminModeratePostUseCase,
  BookmarkPostUseCase,
  CreateDraftUseCase,
  DeleteCommentUseCase,
  DeletePostUseCase,
  EditCommentUseCase,
  GetPostDetailUseCase,
  ListCommentsUseCase,
  ListPostsUseCase,
  PublishPostUseCase,
  SetReactionUseCase,
  TrackShareUseCase,
  UpdatePostUseCase,
} from '../index.js';
import type { CommerceServicePort } from '../ports/commerce-service.port.js';
import type { EventPublisherPort } from '../ports/event-publisher.port.js';
import type {
  PostRecord,
  CommentRecord,
} from '../../../db/schema/index.js';

describe('Social Application Use Cases', () => {
  const authorId = '018d9f00-user-7000-8000-000000000001';
  const otherUserId = '018d9f00-user-7000-8000-000000000002';
  const moderatorId = '018d9f00-mod-7000-8000-000000000009';
  const postId = '018d9f20-post-7000-8000-000000000001';

  let mockPostRepo: any;
  let mockCommentRepo: any;
  let mockReactionRepo: any;
  let mockBookmarkRepo: any;
  let mockModerationRepo: any;
  let mockEventPublisher: EventPublisherPort;
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
      incrementCounter: vi.fn(),
      updateReactionCounts: vi.fn(),
    };
    mockCommentRepo = {
      create: vi.fn(),
      findById: vi.fn(),
      update: vi.fn(),
      softDelete: vi.fn(),
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
    mockEventPublisher = {
      publish: vi.fn().mockResolvedValue(undefined),
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
  });

  describe('PublishPostUseCase', () => {
    it('xuất bản thành công và gắn dấu isVerified khi đơn đã hoàn tất bên commerce', async () => {
      const post = samplePostRecord();
      mockPostRepo.findById.mockResolvedValue(post);
      mockPostRepo.update.mockResolvedValue({ ...post, status: 'published', isVerified: true });
      (mockCommerceService.verifyCompletedBooking as any).mockResolvedValue(true);

      const useCase = new PublishPostUseCase(mockPostRepo, mockEventPublisher, mockCommerceService);
      const result = await useCase.execute({ postId, userId: authorId });

      expect(result.status).toBe('published');
      expect(result.isVerified).toBe(true);
      expect(result.shareUrl).toBe(`https://tripflix.vn/posts/${postId}`);
      expect(mockEventPublisher.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'content.post.published',
        }),
      );
    });

    it('xuất bản không có dấu isVerified nếu chuyến đi tự tạo không có booking hoàn tất', async () => {
      const post = samplePostRecord({
        tripAttachment: { destinationName: 'Đà Lạt', hotelName: 'Khách sạn X' },
      });
      mockPostRepo.findById.mockResolvedValue(post);
      mockPostRepo.update.mockResolvedValue({ ...post, status: 'published', isVerified: false });

      const useCase = new PublishPostUseCase(mockPostRepo, mockEventPublisher, mockCommerceService);
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

    it('xóa bài đăng thành công và bắn event content.post.deleted', async () => {
      const post = samplePostRecord({ status: 'published' });
      mockPostRepo.findById.mockResolvedValue(post);
      mockPostRepo.softDelete.mockResolvedValue(undefined);

      const useCase = new DeletePostUseCase(mockPostRepo, mockEventPublisher);
      const result = await useCase.execute({ postId, userId: authorId });

      expect(result.deleted).toBe(true);
      expect(mockPostRepo.softDelete).toHaveBeenCalledWith(postId);
      expect(mockEventPublisher.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'content.post.deleted',
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

      const useCase = new GetPostDetailUseCase(
        mockPostRepo,
        mockReactionRepo,
        mockBookmarkRepo,
      );

      const result = await useCase.execute({ postId, viewerId: otherUserId });

      expect(result.post.title).toBe('Review Phú Quốc');
      expect((result.post.tripAttachment as any).bookingId).toBeUndefined(); // PII bị ẩn
      expect(result.post.tripAttachment?.priceDisclaimer).toBe('Giá chỉ mang tính chất tham khảo');
      expect(result.viewerContext.myReaction).toBe('like');
      expect(result.viewerContext.isBookmarked).toBe(true);
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

      const useCase = new SetReactionUseCase(
        mockPostRepo,
        mockReactionRepo,
        mockEventPublisher,
      );

      const result = await useCase.execute({ postId, userId: otherUserId, type: 'like' });

      expect(result.myReaction).toBe('like');
      expect(result.reactionTotal).toBe(1);
      expect(mockReactionRepo.upsert).toHaveBeenCalledWith(postId, otherUserId, 'like');
      expect(mockPostRepo.updateReactionCounts).toHaveBeenCalledWith(postId, { like: 1 }, 1);
      expect(mockEventPublisher.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'content.reaction.updated',
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

      const useCase = new SetReactionUseCase(
        mockPostRepo,
        mockReactionRepo,
        mockEventPublisher,
      );

      const result = await useCase.execute({ postId, userId: otherUserId, type: null });

      expect(result.myReaction).toBeNull();
      expect(result.reactionTotal).toBe(0);
      expect(mockReactionRepo.delete).toHaveBeenCalledWith(postId, otherUserId);
    });
  });

  describe('Comment Use Cases', () => {
    it('tạo bình luận tăng commentCount và phát sự kiện outbox', async () => {
      const post = samplePostRecord({ status: 'published' });
      const commentRecord: CommentRecord = {
        id: 'comm-1',
        postId,
        authorId: otherUserId,
        parentCommentId: null,
        body: 'Bài viết hay quá!',
        isEdited: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      };

      mockPostRepo.findById.mockResolvedValue(post);
      mockCommentRepo.create.mockResolvedValue(commentRecord);

      const useCase = new AddCommentUseCase(
        mockPostRepo,
        mockCommentRepo,
        mockEventPublisher,
      );

      const result = await useCase.execute({
        postId,
        authorId: otherUserId,
        body: 'Bài viết hay quá!',
      });

      expect(result.id).toBe('comm-1');
      expect(mockPostRepo.incrementCounter).toHaveBeenCalledWith(postId, 'commentCount', 1);
      expect(mockEventPublisher.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'content.comment.created',
        }),
      );
    });

    it('từ chối bình luận khi reply vào một reply khác (chặn reply cấp 2)', async () => {
      const post = samplePostRecord({ status: 'published' });
      // Bình luận cha này bản thân nó đã là reply của một comment khác (parentCommentId != null)
      const parentReplyRecord: CommentRecord = {
        id: 'reply-1',
        postId,
        authorId: otherUserId,
        parentCommentId: 'root-comment-id',
        body: 'Đây là câu trả lời',
        isEdited: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      };

      mockPostRepo.findById.mockResolvedValue(post);
      mockCommentRepo.findById.mockResolvedValue(parentReplyRecord);

      const useCase = new AddCommentUseCase(
        mockPostRepo,
        mockCommentRepo,
        mockEventPublisher,
      );

      await expect(
        useCase.execute({
          postId,
          authorId: otherUserId,
          body: 'Cố tình reply vào reply',
          parentCommentId: 'reply-1',
        }),
      ).rejects.toThrow(/Chỉ hỗ trợ phản hồi bình luận 1 cấp/);
    });

    it('xóa bình luận giảm commentCount của bài viết', async () => {
      const commentRecord: CommentRecord = {
        id: 'comm-1',
        postId,
        authorId: otherUserId,
        parentCommentId: null,
        body: 'Bình luận sắp xóa',
        isEdited: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      };

      mockCommentRepo.findById.mockResolvedValue(commentRecord);
      mockCommentRepo.softDelete.mockResolvedValue(undefined);

      const useCase = new DeleteCommentUseCase(mockCommentRepo, mockPostRepo);
      const result = await useCase.execute({ commentId: 'comm-1', userId: otherUserId });

      expect(result.deleted).toBe(true);
      expect(mockCommentRepo.softDelete).toHaveBeenCalledWith('comm-1');
      expect(mockPostRepo.incrementCounter).toHaveBeenCalledWith(postId, 'commentCount', -1);
    });
  });

  describe('Bookmark & Share Use Cases', () => {
    it('bookmark bài viết tăng bookmarkCount', async () => {
      const post = samplePostRecord({ status: 'published', bookmarkCount: 5 });
      mockPostRepo.findById
        .mockResolvedValueOnce(post)
        .mockResolvedValueOnce({ ...post, bookmarkCount: 6 });
      mockBookmarkRepo.isBookmarked.mockResolvedValue(false);

      const useCase = new BookmarkPostUseCase(mockPostRepo, mockBookmarkRepo);
      const result = await useCase.execute({ postId, userId: otherUserId, isBookmarked: true });

      expect(result.isBookmarked).toBe(true);
      expect(result.bookmarkCount).toBe(6);
      expect(mockBookmarkRepo.setBookmark).toHaveBeenCalledWith(postId, otherUserId, true);
      expect(mockPostRepo.incrementCounter).toHaveBeenCalledWith(postId, 'bookmarkCount', 1);
    });

    it('ghi nhận lượt chia sẻ tăng shareCount và trả về deep link', async () => {
      const post = samplePostRecord({ status: 'published', shareCount: 10 });
      mockPostRepo.findById
        .mockResolvedValueOnce(post)
        .mockResolvedValueOnce({ ...post, shareCount: 11 });

      const useCase = new TrackShareUseCase(mockPostRepo, mockEventPublisher);
      const result = await useCase.execute({ postId, userId: otherUserId });

      expect(result.shareCount).toBe(11);
      expect(result.shareUrl).toBe(`https://tripflix.vn/posts/${postId}`);
      expect(mockPostRepo.incrementCounter).toHaveBeenCalledWith(postId, 'shareCount', 1);
      expect(mockEventPublisher.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'content.post.shared',
        }),
      );
    });
  });

  describe('AdminModeratePostUseCase', () => {
    it('ẩn bài đăng, lưu nhật ký kiểm duyệt và phát sự kiện outbox content.post.moderated', async () => {
      const post = samplePostRecord({ status: 'published' });
      mockPostRepo.findById.mockResolvedValue(post);
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

      const useCase = new AdminModeratePostUseCase(
        mockPostRepo,
        mockModerationRepo,
        mockEventPublisher,
      );

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
      expect(mockEventPublisher.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'content.post.moderated',
        }),
      );
    });
  });
});
