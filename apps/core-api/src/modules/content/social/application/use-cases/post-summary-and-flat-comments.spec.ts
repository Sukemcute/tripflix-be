import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { ClsModule } from 'nestjs-cls';
import { createNoOpTransactionalPlugins } from '@tripflix/db';
import { PostNotFoundException } from '../../domain/index.js';
import {
  AddCommentUseCase,
  GetPostSummaryUseCase,
  ListCommentsUseCase,
  SavePostSummaryUseCase,
} from '../index.js';
import { PostSummaryController } from '../../api/post-summary.controller.js';
import type { PostRecord } from '../../../db/schema/index.js';

describe('Post Summary and Flat Comments Use Cases', () => {
  beforeAll(async () => {
    await Test.createTestingModule({
      imports: [ClsModule.forRoot({ global: true, plugins: createNoOpTransactionalPlugins() })],
    }).compile();
  });

  const postId = '018d9f20-0000-7000-8000-000000000001';
  const authorId = '018d9f00-0000-7000-8000-000000000001';

  const mockPost: PostRecord = {
    id: postId,
    authorId,
    postType: 'video',
    status: 'published',
    visibility: 'public',
    isVerified: false,
    title: 'Bài viết test',
    body: 'Nội dung test',
    hashtags: ['test'],
    mediaIds: ['media-1'],
    coverMediaId: 'media-1',
    tripAttachment: null,
    reactionCounts: {},
    reactionTotal: 0,
    commentCount: 5,
    shareCount: 0,
    bookmarkCount: 0,
    publishedAt: new Date(),
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  let mockPostRepo: any;
  let mockCommentRepo: any;
  let mockPostSummaryRepo: any;
  let mockOutbox: any;

  beforeEach(() => {
    mockPostRepo = {
      findById: vi.fn().mockResolvedValue(mockPost),
      incrementCounter: vi.fn().mockResolvedValue(undefined),
    };
    mockPostRepo.findByIdForUpdate = mockPostRepo.findById;
    mockCommentRepo = {
      create: vi.fn(),
      findById: vi.fn(),
      findByPostId: vi.fn().mockResolvedValue([]),
      countByPostId: vi.fn().mockResolvedValue(0),
      countRepliesByParentIds: vi.fn().mockResolvedValue(new Map()),
      hasDiscussionChangedSince: vi.fn().mockResolvedValue(false),
      hasUnavailableSince: vi.fn().mockResolvedValue(false),
      findVisibleIds: vi.fn().mockResolvedValue([]),
    };
    mockPostSummaryRepo = {
      findByPostId: vi.fn(),
      upsert: vi.fn(),
      saveIfNewer: vi.fn(),
    };
    mockOutbox = {
      add: vi.fn().mockResolvedValue(undefined),
    };
  });

  describe('AddCommentUseCase - Giới hạn 2.000 ký tự', () => {
    it('từ chối bình luận vượt quá 2.000 ký tự', async () => {
      const useCase = new AddCommentUseCase(mockPostRepo, mockCommentRepo, mockOutbox);
      const tooLong = 'X'.repeat(2_001);

      await expect(
        useCase.execute({
          postId,
          authorId,
          body: tooLong,
        }),
      ).rejects.toThrow('Nội dung bình luận không được vượt quá 2,000 ký tự');
    });

    it('từ chối bình luận rỗng', async () => {
      const useCase = new AddCommentUseCase(mockPostRepo, mockCommentRepo, mockOutbox);

      await expect(
        useCase.execute({
          postId,
          authorId,
          body: '   ',
        }),
      ).rejects.toThrow('Nội dung bình luận không được để trống');
    });
  });

  describe('ListCommentsUseCase - Hỗ trợ flat=true cho AI & sửa total', () => {
    it('mặc định chỉ lấy bình luận gốc và giới hạn limit tối đa 50', async () => {
      const useCase = new ListCommentsUseCase(mockPostRepo, mockCommentRepo);

      await useCase.execute({
        postId,
        limit: 100, // vượt quá 50
      });

      expect(mockCommentRepo.findByPostId).toHaveBeenCalledWith(
        expect.objectContaining({
          postId,
          limit: 51, // Math.min(100, 50) + 1
          flat: undefined,
          parentCommentId: undefined,
        }),
      );

      expect(mockCommentRepo.countByPostId).toHaveBeenCalledWith(postId, {
        flat: undefined,
        parentCommentId: undefined,
      });
    });

    it('trả số trả lời của từng bình luận, bình luận không có trả lời là 0', async () => {
      mockCommentRepo.findByPostId.mockResolvedValue([
        { id: 'c1', postId, authorId, parentCommentId: null, body: 'Có trả lời', createdAt: new Date() },
        { id: 'c2', postId, authorId, parentCommentId: null, body: 'Chưa ai trả lời', createdAt: new Date() },
      ]);
      mockCommentRepo.countRepliesByParentIds.mockResolvedValue(new Map([['c1', 3]]));
      const useCase = new ListCommentsUseCase(mockPostRepo, mockCommentRepo);

      const result = await useCase.execute({ postId });

      expect(mockCommentRepo.countRepliesByParentIds).toHaveBeenCalledWith(['c1', 'c2']);
      expect(result.items.map((item) => [item.id, item.replyCount])).toEqual([
        ['c1', 3],
        ['c2', 0],
      ]);
    });

    it('tự động fallback limit về 20 khi client truyền limit không hợp lệ (NaN hoặc số âm)', async () => {
      const useCase = new ListCommentsUseCase(mockPostRepo, mockCommentRepo);

      await useCase.execute({
        postId,
        limit: Number('invalid-limit'), // NaN
      });

      expect(mockCommentRepo.findByPostId).toHaveBeenCalledWith(
        expect.objectContaining({
          limit: 21, // 20 + 1
        }),
      );
    });

    it('khi bật flat=true: cho phép limit lên tới 200 và lấy phẳng mọi cấp bình luận', async () => {
      const mockFlatComments = [
        { id: 'c1', postId, authorId, parentCommentId: null, body: 'Gốc 1', createdAt: new Date() },
        { id: 'c2', postId, authorId, parentCommentId: 'c1', body: 'Reply 1', createdAt: new Date() },
      ];
      mockCommentRepo.findByPostId.mockResolvedValue(mockFlatComments);
      mockCommentRepo.countByPostId.mockResolvedValue(2);

      const useCase = new ListCommentsUseCase(mockPostRepo, mockCommentRepo);

      const result = await useCase.execute({
        postId,
        limit: 200,
        flat: true,
      });

      expect(mockCommentRepo.findByPostId).toHaveBeenCalledWith(
        expect.objectContaining({
          postId,
          limit: 201,
          flat: true,
        }),
      );

      expect(mockCommentRepo.countByPostId).toHaveBeenCalledWith(postId, {
        flat: true,
        parentCommentId: undefined,
      });

      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it('từ chối xem danh sách bình luận nếu bài viết ở trạng thái draft và người xem là người lạ', async () => {
      mockPostRepo.findById.mockResolvedValueOnce({
        ...mockPost,
        status: 'draft',
        authorId: 'author-123',
      });

      const useCase = new ListCommentsUseCase(mockPostRepo, mockCommentRepo);
      await expect(
        useCase.execute({
          postId,
          viewerId: 'stranger-456',
        }),
      ).rejects.toThrow(PostNotFoundException);
    });

    it('cho phép tác giả bài viết xem bình luận của bài viết draft của chính mình', async () => {
      mockPostRepo.findById.mockResolvedValueOnce({
        ...mockPost,
        status: 'draft',
        authorId: 'author-123',
      });

      const useCase = new ListCommentsUseCase(mockPostRepo, mockCommentRepo);
      const res = await useCase.execute({
        postId,
        viewerId: 'author-123',
      });
      expect(res.items).toBeDefined();
    });
  });

  describe('SavePostSummaryUseCase & GetPostSummaryUseCase', () => {
    it('lưu thành công kết quả tóm tắt từ AI', async () => {
      const genDate = new Date('2026-11-05T14:00:00Z');
      const mockSummaryRecord = {
        postId,
        summary: 'Tóm tắt bài viết trải nghiệm du lịch Ninh Bình...',
        keyTakeaways: ['Đi thuyền sớm', 'Emeralda chu đáo'],
        inputHash: 'hash-abc',
        commentCountAtSummary: 25,
        createdAt: new Date(),
        updatedAt: new Date(),
        generatedAt: genDate,
      };
      mockPostSummaryRepo.saveIfNewer.mockResolvedValue(mockSummaryRecord);

      const useCase = new SavePostSummaryUseCase(mockPostRepo, mockPostSummaryRepo);

      const result = await useCase.execute({
        postId,
        summary: 'Tóm tắt bài viết trải nghiệm du lịch Ninh Bình...',
        keyTakeaways: ['Đi thuyền sớm', 'Emeralda chu đáo'],
        inputHash: 'hash-abc',
        commentCount: 25,
        generatedAt: genDate,
      });

      expect(result.summary).toBe(mockSummaryRecord.summary);
      expect(mockPostSummaryRepo.saveIfNewer).toHaveBeenCalledWith({
        postId,
        status: 'ready',
        summary: 'Tóm tắt bài viết trải nghiệm du lịch Ninh Bình...',
        keyTakeaways: ['Đi thuyền sớm', 'Emeralda chu đáo'],
        content: null,
        safety: null,
        inputHash: 'hash-abc',
        sourceCommentIds: null,
        commentCountAtSummary: 25,
        promptVersion: null,
        modelName: null,
        generatedAt: genDate,
      });
    });

    it('từ chối lưu tóm tắt khi bài viết không tồn tại', async () => {
      mockPostRepo.findById.mockResolvedValue(null);
      const useCase = new SavePostSummaryUseCase(mockPostRepo, mockPostSummaryRepo);

      await expect(
        useCase.execute({
          postId: 'unknown-id',
          summary: 'Nội dung tóm tắt',
          generatedAt: new Date(),
        }),
      ).rejects.toThrow(PostNotFoundException);
    });

    it('từ chối lưu khi nội dung tóm tắt bị rỗng hoặc thiếu generatedAt', async () => {
      const useCase = new SavePostSummaryUseCase(mockPostRepo, mockPostSummaryRepo);

      await expect(
        useCase.execute({
          postId,
          summary: '   ',
          generatedAt: new Date(),
        }),
      ).rejects.toThrow('Nội dung tóm tắt không được để trống');

      await expect(
        useCase.execute({
          postId,
          summary: 'Có tóm tắt',
          generatedAt: null,
        }),
      ).rejects.toThrow('generatedAt là bắt buộc');
    });

    it('lấy tóm tắt bài viết thành công kèm cờ isStale khi thảo luận không đổi', async () => {
      const genDate = new Date('2026-11-05T14:00:00Z');
      const mockSummaryRecord = {
        postId,
        summary: 'Tóm tắt bài viết',
        keyTakeaways: [],
        inputHash: null,
        commentCountAtSummary: 5,
        generatedAt: genDate,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockPostSummaryRepo.findByPostId.mockResolvedValue(mockSummaryRecord);
      mockCommentRepo.hasDiscussionChangedSince.mockResolvedValue(false);

      const useCase = new GetPostSummaryUseCase(mockPostRepo, mockPostSummaryRepo, mockCommentRepo);
      const result = await useCase.execute(postId);

      // post có commentCount: 5 và summary có commentCountAtSummary: 5, thảo luận không đổi -> isStale: false
      expect(result).toEqual({
        ...mockSummaryRecord,
        content: undefined,
        safety: undefined,
        sourceCommentIds: null,
        isStale: false,
      });
    });

    it('bật isStale: true khi có comment mới hoặc comment cũ bị sửa nội dung sau thời điểm generatedAt', async () => {
      const genDate = new Date('2026-11-05T14:00:00Z');
      const mockSummaryRecord = {
        postId,
        summary: 'Tóm tắt bài viết',
        keyTakeaways: [],
        inputHash: null,
        commentCountAtSummary: 5,
        generatedAt: genDate,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockPostSummaryRepo.findByPostId.mockResolvedValue(mockSummaryRecord);
      mockCommentRepo.hasDiscussionChangedSince.mockResolvedValue(true);

      const useCase = new GetPostSummaryUseCase(mockPostRepo, mockPostSummaryRepo, mockCommentRepo);
      const result = await useCase.execute(postId);

      // Thảo luận đã bị sửa đổi sau generatedAt -> isStale: true
      expect(result).toEqual({
        ...mockSummaryRecord,
        content: undefined,
        safety: undefined,
        sourceCommentIds: null,
        isStale: true,
      });
    });

    it('từ chối xem tóm tắt nếu bài viết ở trạng thái draft và người xem không phải tác giả', async () => {
      mockPostRepo.findById.mockResolvedValueOnce({
        ...mockPost,
        status: 'draft',
        authorId: 'author-123',
      });

      const useCase = new GetPostSummaryUseCase(mockPostRepo, mockPostSummaryRepo);
      await expect(
        useCase.execute({
          postId,
          viewerId: 'stranger-456',
        }),
      ).rejects.toThrow(PostNotFoundException);
    });

    it('ẩn safety.pendingWarnings với người xem thường, moderator vẫn thấy', async () => {
      const safety = {
        warnings: [{ categories: ['ngo_doc'], commentIds: ['c1'] }],
        pendingWarnings: [{ categories: ['tai_nan'], commentIds: ['c2'] }],
      };
      mockPostSummaryRepo.findByPostId.mockResolvedValue({
        postId,
        summary: 'Tóm tắt bài viết',
        keyTakeaways: [],
        safety,
        commentCountAtSummary: 5,
        generatedAt: null,
      });
      const useCase = new GetPostSummaryUseCase(mockPostRepo, mockPostSummaryRepo, mockCommentRepo);

      mockCommentRepo.findVisibleIds.mockResolvedValue(['c1', 'c2']);
      const forGuest = await useCase.execute({ postId });
      const forMember = await useCase.execute({ postId, viewerId: 'member-1' });
      const forModerator = await useCase.execute({ postId, viewerId: 'mod-1', isStaff: true });

      expect(forGuest?.safety).toEqual({ warnings: safety.warnings });
      expect(forMember?.safety).toEqual({ warnings: safety.warnings });
      expect(forModerator?.safety).toEqual(safety);
    });

    it('trả về null khi bài viết chưa có tóm tắt', async () => {
      mockPostSummaryRepo.findByPostId.mockResolvedValue(null);

      const useCase = new GetPostSummaryUseCase(mockPostRepo, mockPostSummaryRepo);
      const result = await useCase.execute(postId);

      expect(result).toBeNull();
    });
  });

  describe('PostSummaryController', () => {
    it('gọi saveSummary và getSummary thành công', async () => {
      const mockSummaryRecord = {
        postId,
        summary: 'Tóm tắt bài viết',
        keyTakeaways: ['Ý 1'],
        inputHash: 'hash-1',
        commentCountAtSummary: 10,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const saveUseCase = { execute: vi.fn().mockResolvedValue(mockSummaryRecord) } as any;
      const getUseCase = { execute: vi.fn().mockResolvedValue(mockSummaryRecord) } as any;

      const controller = new PostSummaryController(saveUseCase, getUseCase, {} as any);

      const saved = await controller.saveSummary(postId, {
        status: 'ready',
        summary: 'Tóm tắt bài viết',
        keyTakeaways: ['Ý 1'],
        inputHash: 'hash-1',
        commentCount: 10,
        generatedAt: new Date(),
      } as any);
      expect(saved).toEqual(mockSummaryRecord);

      const fetched = await controller.getSummary(postId);
      expect(fetched).toEqual(mockSummaryRecord);
    });

    it('ném NotFoundException khi bài viết chưa có tóm tắt trong getSummary', async () => {
      const saveUseCase = {} as any;
      const getUseCase = { execute: vi.fn().mockResolvedValue(null) } as any;

      const controller = new PostSummaryController(saveUseCase, getUseCase, {} as any);

      await expect(controller.getSummary(postId)).rejects.toThrow(
        `Bài viết ${postId} chưa có bản tóm tắt nào`,
      );
    });
  });
});
