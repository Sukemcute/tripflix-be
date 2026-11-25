import { buildIndex } from './build.js';
import { MemoryExploreSource } from './memory-source.js';
import { searchExplore } from './rank.js';
import type { CandidateFilter, ExploreObject } from './types.js';

/** Nguồn trong RAM ghi lại `limit` từng nhánh gửi đi (Typesense đọc `limit`, RAM/Postgres bỏ qua). */
function recordingSource(objs: ExploreObject[]) {
  const limits = new Map<string, number | undefined>();
  const inner = new MemoryExploreSource(buildIndex(objs));
  const source = Object.assign(Object.create(inner) as MemoryExploreSource, {
    candidates: (f: CandidateFilter) => {
      limits.set(f.vertical, f.limit);
      return inner.candidates(f);
    },
  });
  return { source, limits };
}

const objs: ExploreObject[] = [
  { id: 'hotel:H1', refId: 'H1', kind: 'stay', title: 'Khách sạn biển Đà Nẵng', place: 'Đà Nẵng', priceNight: 1_000_000 },
  { id: 'post:P1', refId: 'P1', kind: 'post', title: 'Khách sạn đẹp ở Đà Nẵng', place: 'Đà Nẵng' },
  { id: 'post:V1', refId: 'V1', kind: 'video', title: 'Review khách sạn Đà Nẵng', place: 'Đà Nẵng' },
];

describe('searchExplore: số ứng viên mỗi nhánh', () => {
  it('/api/search: nhánh câu nhắm tới lấy đủ, nhánh phụ lấy ít', async () => {
    const { source, limits } = recordingSource(objs);
    await searchExplore(source, 'khách sạn đà nẵng');
    expect(limits.get('stays')).toBe(100);
    expect(limits.get('plans')).toBe(30);
  });

  it('tab Bài viết (fullKinds) luôn là nhánh chính dù câu nhắm vùng khác', async () => {
    const { source, limits } = recordingSource(objs);
    await searchExplore(source, 'khách sạn đà nẵng', { perSection: 1000, fullKinds: ['plan', 'video', 'post'] });
    expect(limits.get('plans')).toBe(250);
    expect(limits.get('videos')).toBe(250);
  });
});
