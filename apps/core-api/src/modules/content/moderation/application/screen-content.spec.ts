import { describe, expect, it, vi } from 'vitest';
import { ScreenContentUseCase } from './moderation.use-cases.js';

describe('ScreenContentUseCase', () => {
  it('ghi tín hiệu luật rồi yêu cầu stream thử lại khi AI không khả dụng', async () => {
    const target = {
      targetType: 'comment',
      targetId: 'c',
      postId: 'p',
      authorId: 'a',
      text: 'test',
      status: 'visible',
      version: 'v',
      coverMediaId: null,
      deleted: false,
    };
    const repository = {
      loadTarget: vi.fn().mockResolvedValue(target),
      scan: vi.fn().mockResolvedValue(undefined),
    };
    const ai = { moderate: vi.fn().mockResolvedValue(null) };
    const record = { execute: vi.fn().mockResolvedValue(undefined) };
    const media = { getPlayback: vi.fn() };
    const useCase = new ScreenContentUseCase(
      repository as never,
      ai as never,
      record as never,
      media as never,
    );
    await expect(useCase.execute('event', 'comment', 'c')).rejects.toThrow('retry screening');
    expect(record.execute).toHaveBeenCalledWith('event', target, null, undefined);
  });
});
