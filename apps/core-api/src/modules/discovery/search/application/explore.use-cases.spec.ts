import { buildIndex } from '../domain/explore/build.js';
import { MemoryExploreSource } from '../domain/explore/memory-source.js';
import type { BuiltIndex } from '../domain/explore/types.js';
import { ExploreUseCases, hotelToObject, postToObject } from './explore.use-cases.js';
import type { ExploreCatalog, ExploreHotel, ExplorePost, ExploreStore } from './ports.js';

const hotel = (id: string, name: string, province: string, extra: Partial<ExploreHotel> = {}): ExploreHotel => ({
  id,
  name,
  province: { slug: id, name: province },
  city: null,
  stars: 4,
  brand: null,
  style: null,
  thumbnail: null,
  priceFrom: 1_000_000,
  address: null,
  location: null,
  ...extra,
});

const post = (id: string, title: string, extra: Partial<ExplorePost> = {}): ExplorePost => ({
  id,
  postType: 'vlog',
  title,
  body: '',
  hashtags: [],
  tripAttachment: null,
  reactionTotal: 10,
  commentCount: 1,
  ...extra,
});

class FakeStore extends MemoryExploreSource implements ExploreStore {
  saved: BuiltIndex | null = null;
  async replaceAll(index: BuiltIndex) {
    this.saved = index;
    return true;
  }
}

function setup(hotels: ExploreHotel[], posts: ExplorePost[], hidden: string[] = []) {
  const store = new FakeStore(buildIndex([...hotels.map(hotelToObject), ...posts.map(postToObject)]));
  const catalog: ExploreCatalog = {
    listHotels: async () => ({ items: hotels, nextCursor: null }),
    listPosts: async () => ({ items: posts, nextCursor: null }),
    findVisiblePostIds: async (ids) => new Set(ids.filter((id) => !hidden.includes(id))),
  };
  return { store, explore: new ExploreUseCases(store, catalog) };
}

describe('ExploreUseCases', () => {
  it('map khách sạn, bài, video sang đúng vùng và nơi', () => {
    expect(hotelToObject(hotel('H1', 'Dalat Palace', 'Lâm Đồng', { city: 'Đà Lạt', location: { lat: 11.9, lng: 108.4 } }))).toMatchObject({
      id: 'hotel:H1', kind: 'stay', place: 'Đà Lạt', lat: 11.9, lon: 108.4, priceNight: 1_000_000,
    });
    const trip = { destinationName: 'Đà Nẵng', daysCount: 3, estimatedCostPerPerson: 2_500_000 };
    expect(postToObject(post('P1', 'Lịch trình Đà Nẵng', { tripAttachment: trip }))).toMatchObject({ kind: 'plan', place: 'Đà Nẵng', days: 3, cost: 2_500_000 });
    expect(postToObject(post('P2', 'Săn mây', { postType: 'video', tripAttachment: trip }))).toMatchObject({ kind: 'video', topics: ['plan'] });
    expect(postToObject(post('P3', 'Review quán'))).toMatchObject({ kind: 'post', place: null });
  });

  it('tìm theo nơi, ngân sách; bài bị ẩn không lọt ra kết quả', async () => {
    const trip = (d: number) => ({ destinationName: 'Đà Nẵng', daysCount: d, estimatedCostPerPerson: 2_500_000 });
    const { explore } = setup(
      [hotel('H1', 'Vinpearl Resort Đà Nẵng', 'Đà Nẵng'), hotel('H2', 'Dalat Palace', 'Đà Lạt'), hotel('H3', 'Sang Resort', 'Đà Nẵng', { priceFrom: 9_000_000 })],
      [post('P1', 'Trọn bộ lịch trình Đà Nẵng 3N2Đ', { tripAttachment: trip(3) }), post('P2', 'Lịch trình Đà Nẵng 3 ngày', { tripAttachment: trip(3) })],
      ['P2'],
    );
    const stays = await explore.search({ q: 'khách sạn đà nẵng dưới 2tr' });
    expect(stays.understood).toMatchObject({ place: 'Đà Nẵng', budget: 2_000_000 });
    expect(stays.sections[0]).toMatchObject({ kind: 'stay', items: [{ id: 'hotel:H1', refId: 'H1' }] });
    const plans = await explore.search({ q: 'lịch trình đà nẵng 3n2đ' });
    expect(plans.sections.find((s) => s.kind === 'plan')!.items.map((i) => i.refId)).toEqual(['P1']);
  });

  it('dựng lại chỉ mục từ cả hai nguồn', async () => {
    const { explore, store } = setup([hotel('H1', 'A', 'Huế')], [post('P1', 'B')]);
    expect(await explore.rebuildIndex()).toBe(2);
    expect(store.saved!.docs.map((d) => d.id)).toEqual(['hotel:H1', 'post:P1']);
  });
});
