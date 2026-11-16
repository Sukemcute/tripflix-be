import { BadRequestException } from '@nestjs/common';
import type { ExploreUseCases } from '../application/explore.use-cases.js';
import { AdminVocabGapsController } from './admin-vocab-gaps.controller.js';

function setup() {
  const vocabGaps = vi.fn(async (q: { days: number }) => ({ days: q.days, queries: 0, items: [] }));
  return { controller: new AdminVocabGapsController({ vocabGaps } as unknown as ExploreUseCases), vocabGaps };
}

describe('AdminVocabGapsController', () => {
  it('mặc định 7 ngày, 50 mục, ít nhất 3 lượt; đọc số từ query string', async () => {
    const { controller, vocabGaps } = setup();
    await controller.list({});
    expect(vocabGaps).toHaveBeenLastCalledWith({ days: 7, limit: 50, minCount: 3 });
    await controller.list({ days: '30', limit: '10', minCount: '1' });
    expect(vocabGaps).toHaveBeenLastCalledWith({ days: 30, limit: 10, minCount: 1 });
  });

  it.each([{ days: '0' }, { days: '91' }, { limit: '201' }, { minCount: 'x' }])('tham số ngoài khoảng %o -> 400', async (query) => {
    const { controller, vocabGaps } = setup();
    await expect(controller.list(query)).rejects.toBeInstanceOf(BadRequestException);
    expect(vocabGaps).not.toHaveBeenCalled();
  });
});
