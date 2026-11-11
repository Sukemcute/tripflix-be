import 'reflect-metadata';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { PostNotFoundException } from '../../domain/index.js';
import {
  SampleCommentsUseCase,
  GetCommentStatsUseCase,
  ReconcileHeldSummariesUseCase,
} from '../index.js';
import { CommentsController } from '../../api/comments.controller.js';
import { AiSummaryInternalController } from '../../api/ai-summary-internal.controller.js';
import type { PostRecord, CommentRecord } from '../../../db/schema/index.js';
import type { SampledCommentRecord } from '../../infra/comment.repository.js';

describe('Comment Sampling and AI Reconciliation', () => {
  const authorId = '018d9f00-user-7000-8000-000000000001';
  const postId = '018d9f20-post-7000-8000-000000000001';

  let mockPostRepo: any;
  let mockCommentRepo: any;
  let mockPostSummaryRepo: any;

  function samplePostRecord(overrides: Partial<PostRecord> = {}): PostRecord {
    return {
      id: postId,
      authorId,
      postType: 'video',
      title: 'Review Phú Quốc',
      body: 'Nội dung chia sẻ...',
      hashtags: ['phuquoc'],
      status: 'published',
      visibility: 'public',
      isVerified: false,
      mediaIds: ['media-1'],
      coverMediaId: null,
      tripAttachment: null,
      reactionCounts: {},
      reactionTotal: 0,
      commentCount: 500,
      shareCount: 0,
      bookmarkCount: 0,
      publishedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      ...overrides,
    };
  }

  function sampleCommentRecord(
    id: string,
    body: string,
    overrides: Partial<SampledCommentRecord> = {},
  ): SampledCommentRecord {
    return {
      id,
      postId,
      authorId,
      parentCommentId: null,
      parentCommentBody: null,
      body,
      isEdited: false,
      likeCount: 5,
      status: 'visible',
      hiddenByActionId: null,
      cascadeRootCommentId: null,
      createdAt: new Date('2026-11-10T10:00:00.000Z'),
      updatedAt: new Date('2026-11-10T10:00:00.000Z'),
      deletedAt: null,
      ...overrides,
    };
  }

  beforeEach(() => {
    mockPostRepo = {
      findById: vi.fn(),
    };
    mockCommentRepo = {
      getCommentStats: vi.fn(),
      sampleComments: vi.fn(),
    };
    mockPostSummaryRepo = {
      findHeldSummaryPostIds: vi.fn(),
    };
  });

  describe('SampleCommentsUseCase', () => {
    it('nên ném PostNotFoundException nếu bài viết không tồn tại', async () => {
      mockPostRepo.findById.mockResolvedValue(null);
      const useCase = new SampleCommentsUseCase(mockPostRepo, mockCommentRepo);

      await expect(useCase.execute({ postId: 'non-existent' })).rejects.toThrow(
        PostNotFoundException,
      );
    });

    it('nên ném PostNotFoundException nếu người xem không có quyền xem bài viết (draft)', async () => {
      mockPostRepo.findById.mockResolvedValue(samplePostRecord({ status: 'draft' }));
      const useCase = new SampleCommentsUseCase(mockPostRepo, mockCommentRepo);

      await expect(
        useCase.execute({ postId, viewerId: 'another-user', isStaff: false }),
      ).rejects.toThrow(PostNotFoundException);
    });

    it('lấy mẫu thành công với size mặc định và trả về đúng metadata stats kèm items', async () => {
      mockPostRepo.findById.mockResolvedValue(samplePostRecord());
      mockCommentRepo.getCommentStats.mockResolvedValue({
        visibleCommentCount: 15000,
        uniqueAuthorCount: 6200,
      });
      mockCommentRepo.sampleComments.mockResolvedValue([
        sampleCommentRecord('c-1', 'Bình luận 1'),
        sampleCommentRecord('c-2', 'Bình luận 2', {
          parentCommentId: 'c-1',
          parentCommentBody: 'Bình luận 1',
          isEdited: true,
          updatedAt: new Date('2026-11-10T11:00:00.000Z'),
          likeCount: 12,
        }),
      ]);

      const useCase = new SampleCommentsUseCase(mockPostRepo, mockCommentRepo);
      const result = await useCase.execute({ postId });

      expect(mockCommentRepo.sampleComments).toHaveBeenCalledWith({
        postId,
        size: 1000,
        seed: undefined,
      });
      expect(result.stats).toEqual({
        visibleCommentCount: 15000,
        uniqueAuthorCount: 6200,
      });
      expect(result.items).toHaveLength(2);
      expect(result.items[0]).toEqual({
        id: 'c-1',
        postId,
        authorId,
        body: 'Bình luận 1',
        parentCommentId: null,
        parentCommentBody: null,
        likeCount: 5,
        createdAt: new Date('2026-11-10T10:00:00.000Z'),
        editedAt: null,
      });
      expect(result.items[1]).toEqual({
        id: 'c-2',
        postId,
        authorId,
        body: 'Bình luận 2',
        parentCommentId: 'c-1',
        parentCommentBody: 'Bình luận 1',
        likeCount: 12,
        createdAt: new Date('2026-11-10T10:00:00.000Z'),
        editedAt: new Date('2026-11-10T11:00:00.000Z'),
      });
    });

    it('lấy mẫu thành công với size tùy chọn và seed tái lập, size bị clamp tối đa 5000', async () => {
      mockPostRepo.findById.mockResolvedValue(samplePostRecord());
      mockCommentRepo.getCommentStats.mockResolvedValue({
        visibleCommentCount: 50000,
        uniqueAuthorCount: 22000,
      });
      mockCommentRepo.sampleComments.mockResolvedValue([]);

      const useCase = new SampleCommentsUseCase(mockPostRepo, mockCommentRepo);
      await useCase.execute({ postId, size: 99999, seed: 'test-seed-123' });

      expect(mockCommentRepo.sampleComments).toHaveBeenCalledWith({
        postId,
        size: 5000,
        seed: 'test-seed-123',
      });
    });
  });

  describe('GetCommentStatsUseCase', () => {
    it('nên ném PostNotFoundException nếu bài viết không tồn tại', async () => {
      mockPostRepo.findById.mockResolvedValue(null);
      const useCase = new GetCommentStatsUseCase(mockPostRepo, mockCommentRepo);

      await expect(useCase.execute({ postId: 'non-existent' })).rejects.toThrow(
        PostNotFoundException,
      );
    });

    it('trả về thống kê chính xác của bài viết visible', async () => {
      mockPostRepo.findById.mockResolvedValue(samplePostRecord());
      mockCommentRepo.getCommentStats.mockResolvedValue({
        visibleCommentCount: 3400,
        uniqueAuthorCount: 1200,
      });

      const useCase = new GetCommentStatsUseCase(mockPostRepo, mockCommentRepo);
      const result = await useCase.execute({ postId });

      expect(result).toEqual({
        postId,
        visibleCommentCount: 3400,
        uniqueAuthorCount: 1200,
      });
    });
  });

  describe('ReconcileHeldSummariesUseCase', () => {
    it('lấy danh sách bài viết bị giữ lại phục vụ đối soát bù', async () => {
      mockPostSummaryRepo.findHeldSummaryPostIds.mockResolvedValue({
        postIds: ['p-1', 'p-2'],
        nextCursor: 'p-2',
      });

      const useCase = new ReconcileHeldSummariesUseCase(mockPostSummaryRepo);
      const result = await useCase.execute({ limit: 10, cursor: 'p-0' });

      expect(mockPostSummaryRepo.findHeldSummaryPostIds).toHaveBeenCalledWith({
        limit: 10,
        cursor: 'p-0',
      });
      expect(result).toEqual({
        postIds: ['p-1', 'p-2'],
        nextCursor: 'p-2',
        total: 2,
      });
    });
  });

  describe('Controllers Integration', () => {
    it('CommentsController.sampleComments gọi đúng sampleCommentsUseCase', async () => {
      const mockSampleUseCase = {
        execute: vi.fn().mockResolvedValue({
          stats: { visibleCommentCount: 100, uniqueAuthorCount: 50 },
          items: [],
        }),
      };
      const controller = new CommentsController(
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        undefined,
        mockSampleUseCase as any,
      );

      const res = await controller.sampleComments(postId, { size: 500, seed: 'abc' });
      expect(mockSampleUseCase.execute).toHaveBeenCalledWith({
        postId,
        size: 500,
        seed: 'abc',
      });
      expect(res.stats.visibleCommentCount).toBe(100);
    });

    it('CommentsController.getCommentStats gọi đúng getCommentStatsUseCase', async () => {
      const mockStatsUseCase = {
        execute: vi.fn().mockResolvedValue({
          postId,
          visibleCommentCount: 100,
          uniqueAuthorCount: 50,
        }),
      };
      const controller = new CommentsController(
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        undefined,
        undefined,
        mockStatsUseCase as any,
      );

      const res = await controller.getCommentStats(postId);
      expect(mockStatsUseCase.execute).toHaveBeenCalledWith({
        postId,
      });
      expect(res.visibleCommentCount).toBe(100);
    });

    it('AiSummaryInternalController.reconcile gọi đúng reconcileHeldSummariesUseCase', async () => {
      const mockReconcileUseCase = {
        execute: vi.fn().mockResolvedValue({
          postIds: ['p-held-1'],
          nextCursor: null,
          total: 1,
        }),
      };
      const controller = new AiSummaryInternalController(mockReconcileUseCase as any);
      const res = await controller.reconcile({ limit: 20 });

      expect(mockReconcileUseCase.execute).toHaveBeenCalledWith({
        limit: 20,
        cursor: undefined,
      });
      expect(res.postIds).toEqual(['p-held-1']);
    });
  });
});
