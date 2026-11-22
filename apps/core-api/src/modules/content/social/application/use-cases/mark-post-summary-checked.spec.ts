import { describe, expect, it, vi } from 'vitest';
import { PostNotFoundException } from '../../domain/index.js';
import { GetPostSummaryUseCase, MarkPostSummaryCheckedUseCase } from '../index.js';
import { PostSummaryController } from '../../api/post-summary.controller.js';
import { MarkPostSummaryCheckedRequestSchema } from '../../api/dto/post-summary.dto.js';

const postId = '018d9f20-0000-7000-8000-000000000001';
const post = {
  id: postId,
  authorId: '018d9f00-0000-7000-8000-000000000001',
  postType: 'vlog',
  status: 'published',
  visibility: 'public',
  isVerified: false,
  title: 'Bài',
  body: '',
  hashtags: [],
  mediaIds: [],
  coverMediaId: null,
  tripAttachment: null,
  reactionCounts: {},
  reactionTotal: 0,
  commentCount: 6,
  shareCount: 0,
  bookmarkCount: 0,
  publishedAt: new Date(),
  deletedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};
const command = {
  postId,
  inputHash: 'hash-1',
  checkedAt: new Date('2026-11-13T04:10:00Z'),
  commentCount: 6,
};

describe('MarkPostSummaryCheckedUseCase', () => {
  it('chuyển lệnh xuống repository và trả kết quả cập nhật', async () => {
    const postRepo = { findById: vi.fn().mockResolvedValue(post) };
    const summaryRepo = { markChecked: vi.fn().mockResolvedValue(true) };

    const result = await new MarkPostSummaryCheckedUseCase(postRepo as never, summaryRepo as never).execute(command);

    expect(result).toEqual({ updated: true });
    expect(summaryRepo.markChecked).toHaveBeenCalledWith(command);
  });

  it('báo không tìm thấy khi bài không còn hoặc đã xoá, không ghi gì', async () => {
    const summaryRepo = { markChecked: vi.fn() };
    for (const found of [null, { ...post, status: 'deleted' }]) {
      const postRepo = { findById: vi.fn().mockResolvedValue(found) };
      await expect(new MarkPostSummaryCheckedUseCase(postRepo as never, summaryRepo as never).execute(command)).rejects.toBeInstanceOf(
        PostNotFoundException,
      );
    }
    expect(summaryRepo.markChecked).not.toHaveBeenCalled();
  });
});

describe('MarkPostSummaryCheckedRequestSchema', () => {
  it('đổi checkedAt thành Date, từ chối hash rỗng, ngày sai và số âm', () => {
    const parsed = MarkPostSummaryCheckedRequestSchema.parse({
      inputHash: 'hash-1',
      checkedAt: '2026-11-13T04:10:00.000Z',
      commentCount: 6,
    });
    expect(parsed.checkedAt).toEqual(new Date('2026-11-13T04:10:00.000Z'));

    const bad = [
      { inputHash: ' ', checkedAt: '2026-11-13T04:10:00.000Z', commentCount: 6 },
      { inputHash: 'hash-1', checkedAt: 'hôm qua', commentCount: 6 },
      { inputHash: 'hash-1', checkedAt: '2026-11-13T04:10:00.000Z', commentCount: -1 },
    ];
    for (const body of bad) expect(MarkPostSummaryCheckedRequestSchema.safeParse(body).success).toBe(false);
  });
});

describe('PostSummaryController.markChecked', () => {
  it('gọi use case với postId và body đã kiểm', async () => {
    const markUseCase = { execute: vi.fn().mockResolvedValue({ updated: true }) };
    const controller = new PostSummaryController({} as never, {} as never, markUseCase as never);

    const result = await controller.markChecked(postId, {
      inputHash: 'hash-1',
      checkedAt: command.checkedAt,
      commentCount: 6,
    });

    expect(result).toEqual({ updated: true });
    expect(markUseCase.execute).toHaveBeenCalledWith(command);
  });
});

describe('GetPostSummaryUseCase với checkedAt', () => {
  const generatedAt = new Date('2026-11-13T04:00:00Z');
  const summary = {
    postId,
    status: 'ready',
    summary: 'Tóm tắt',
    keyTakeaways: [],
    content: null,
    safety: null,
    inputHash: 'hash-1',
    sourceCommentIds: [],
    commentCountAtSummary: 6,
    generatedAt,
    checkedAt: null as Date | null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  function setup(record: typeof summary, isChangedAfter: (since: Date) => boolean) {
    const postRepo = { findById: vi.fn().mockResolvedValue(post) };
    const summaryRepo = { findByPostId: vi.fn().mockResolvedValue(record) };
    const commentRepo = {
      hasDiscussionChangedSince: vi.fn(async (_postId: string, since: Date) => isChangedAfter(since)),
      hasUnavailableSince: vi.fn().mockResolvedValue(false),
      findVisibleIds: vi.fn().mockResolvedValue([]),
    };
    return { useCase: new GetPostSummaryUseCase(postRepo as never, summaryRepo as never, commentRepo as never), commentRepo };
  }

  // Bình luận emoji lúc 04:05 bị luật lọc bỏ; AI kiểm lại lúc 04:10 thấy đầu vào không đổi.
  const emojiAt = new Date('2026-11-13T04:05:00Z');
  const isChangedAfter = (since: Date) => emojiAt > since;

  it('chưa có lần kiểm: bình luận sau generatedAt làm bản tóm tắt bị coi là cũ', async () => {
    const { useCase } = setup(summary, isChangedAfter);
    expect((await useCase.execute(postId))?.isStale).toBe(true);
  });

  it('có lần kiểm mới hơn: tính thay đổi từ checkedAt nên hết cũ', async () => {
    const { useCase, commentRepo } = setup({ ...summary, checkedAt: new Date('2026-11-13T04:10:00Z') }, isChangedAfter);

    const result = await useCase.execute(postId);

    expect(result?.isStale).toBe(false);
    expect(commentRepo.hasDiscussionChangedSince).toHaveBeenCalledWith(postId, new Date('2026-11-13T04:10:00Z'));
  });

  it('số bình luận vẫn lệch thì vẫn cũ dù đã kiểm', async () => {
    const { useCase } = setup(
      { ...summary, checkedAt: new Date('2026-11-13T04:10:00Z'), commentCountAtSummary: 5 },
      isChangedAfter,
    );
    expect((await useCase.execute(postId))?.isStale).toBe(true);
  });
});
