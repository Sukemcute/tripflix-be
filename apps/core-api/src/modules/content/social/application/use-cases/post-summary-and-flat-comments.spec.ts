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
    mockCommentRepo = {
      create: vi.fn(),
      findById: vi.fn(),
      findByPostId: vi.fn().mockResolvedValue([]),
      countByPostId: vi.fn().mockResolvedValue(0),
    };
    mockPostSummaryRepo = {
      findByPostId: vi.fn(),
      upsert: vi.fn(),
    };
    mockOutbox = {
      add: vi.fn().mockResolvedValue(undefined),
    };
  });

  describe('AddCommentUseCase - Giới hạn 10.000 ký tự', () => {
    it('từ chối bình luận vượt quá 10.000 ký tự', async () => {
      const useCase = new AddCommentUseCase(mockPostRepo, mockCommentRepo, mockOutbox);
      const tooLong = 'X'.repeat(10_001);

      await expect(
        useCase.execute({
          postId,
          authorId,
          body: tooLong,
        }),
      ).rejects.toThrow('Nội dung bình luận không được vượt quá 10,000 ký tự');
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
  });

  describe('SavePostSummaryUseCase & GetPostSummaryUseCase', () => {
    it('lưu thành công kết quả tóm tắt từ AI', async () => {
      const mockSummaryRecord = {
        postId,
        summary: 'Tóm tắt bài viết trải nghiệm du lịch Ninh Bình...',
        keyTakeaways: ['Đi thuyền sớm', 'Emeralda chu đáo'],
        inputHash: 'hash-abc',
        commentCountAtSummary: 25,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockPostSummaryRepo.upsert.mockResolvedValue(mockSummaryRecord);

      const useCase = new SavePostSummaryUseCase(mockPostRepo, mockPostSummaryRepo);

      const result = await useCase.execute({
        postId,
        summary: 'Tóm tắt bài viết trải nghiệm du lịch Ninh Bình...',
        keyTakeaways: ['Đi thuyền sớm', 'Emeralda chu đáo'],
        inputHash: 'hash-abc',
        commentCount: 25,
      });

      expect(result.summary).toBe(mockSummaryRecord.summary);
      expect(mockPostSummaryRepo.upsert).toHaveBeenCalledWith({
        postId,
        summary: 'Tóm tắt bài viết trải nghiệm du lịch Ninh Bình...',
        keyTakeaways: ['Đi thuyền sớm', 'Emeralda chu đáo'],
        inputHash: 'hash-abc',
        commentCountAtSummary: 25,
      });
    });

    it('từ chối lưu tóm tắt khi bài viết không tồn tại', async () => {
      mockPostRepo.findById.mockResolvedValue(null);
      const useCase = new SavePostSummaryUseCase(mockPostRepo, mockPostSummaryRepo);

      await expect(
        useCase.execute({
          postId: 'unknown-id',
          summary: 'Nội dung tóm tắt',
        }),
      ).rejects.toThrow(PostNotFoundException);
    });

    it('từ chối lưu khi nội dung tóm tắt bị rỗng', async () => {
      const useCase = new SavePostSummaryUseCase(mockPostRepo, mockPostSummaryRepo);

      await expect(
        useCase.execute({
          postId,
          summary: '   ',
        }),
      ).rejects.toThrow('Nội dung tóm tắt không được để trống');
    });

    it('lấy tóm tắt bài viết thành công', async () => {
      const mockSummaryRecord = {
        postId,
        summary: 'Tóm tắt bài viết',
        keyTakeaways: [],
        inputHash: null,
        commentCountAtSummary: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockPostSummaryRepo.findByPostId.mockResolvedValue(mockSummaryRecord);

      const useCase = new GetPostSummaryUseCase(mockPostRepo, mockPostSummaryRepo);
      const result = await useCase.execute(postId);

      expect(result).toEqual(mockSummaryRecord);
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

      const controller = new PostSummaryController(saveUseCase, getUseCase);

      const saved = await controller.saveSummary(postId, {
        summary: 'Tóm tắt bài viết',
        key_takeaways: ['Ý 1'],
        input_hash: 'hash-1',
        comment_count: 10,
      });
      expect(saved).toEqual(mockSummaryRecord);

      const fetched = await controller.getSummary(postId);
      expect(fetched).toEqual(mockSummaryRecord);
    });

    it('ném NotFoundException khi bài viết chưa có tóm tắt trong getSummary', async () => {
      const saveUseCase = {} as any;
      const getUseCase = { execute: vi.fn().mockResolvedValue(null) } as any;

      const controller = new PostSummaryController(saveUseCase, getUseCase);

      await expect(controller.getSummary(postId)).rejects.toThrow(
        `Bài viết ${postId} chưa có bản tóm tắt nào`,
      );
    });
  });
});
