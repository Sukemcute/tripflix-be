import type { HotelSummary, SuggestEntity } from '../domain/suggest-entity.js';
import type { HotelCatalog, SuggestStore } from './ports.js';
import { SuggestUseCases } from './suggest.use-cases.js';

class FakeStore implements SuggestStore {
  saved: SuggestEntity[] = [];
  queries: string[] = [];
  candidates: SuggestEntity[] = [];
  findCandidates(normalizedQuery: string) {
    this.queries.push(normalizedQuery);
    return Promise.resolve(this.candidates);
  }
  replaceAll(entities: readonly SuggestEntity[]) {
    this.saved = [...entities];
    return Promise.resolve();
  }
}

const hotel = (id: string): HotelSummary => ({ id, name: id, province: { slug: 'da-lat', name: 'Đà Lạt' }, stars: 3 });

const pagedCatalog = (pages: HotelSummary[][]): HotelCatalog => ({
  listHotels: (cursor) => {
    const index = cursor ? Number(cursor) : 0;
    return Promise.resolve({ items: pages[index] ?? [], nextCursor: index + 1 < pages.length ? String(index + 1) : null });
  },
});

describe('SuggestUseCases', () => {
  it('chuẩn hoá câu gõ trước khi tìm', async () => {
    const store = new FakeStore();
    await new SuggestUseCases(store, pagedCatalog([])).suggest({ q: 'Đà  LẠT', types: ['place'] });
    expect(store.queries).toEqual(['da lat']);
  });

  it('câu còn dưới 2 ký tự sau khi chuẩn hoá thì không tìm', async () => {
    const store = new FakeStore();
    const items = await new SuggestUseCases(store, pagedCatalog([])).suggest({ q: '!!a', types: ['place'] });
    expect(items).toEqual([]);
    expect(store.queries).toEqual([]);
  });

  it('dựng lại chỉ mục đọc hết mọi trang danh mục', async () => {
    const store = new FakeStore();
    const count = await new SuggestUseCases(store, pagedCatalog([[hotel('a'), hotel('b')], [hotel('c')]])).rebuildIndex();
    expect(store.saved.filter((e) => e.type === 'hotel').map((e) => e.refId)).toEqual(['a', 'b', 'c']);
    expect(count).toBe(store.saved.length);
  });
});
