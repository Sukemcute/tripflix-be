import type { EventEnvelope } from '@tripflix/contracts';
import type { Redis } from 'ioredis';
import type { CoreEnv } from '../../../../platform/env.js';
import { ExploreContentConsumer } from '../consumers/explore-content.consumer.js';
import { buildIndex } from '../domain/explore/build.js';
import { RebuildExploreIndexJob } from '../jobs/rebuild-explore-index.job.js';
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

/** Chỉ mục trong RAM: replaceAll và deleteDocuments đổi đúng tập tài liệu mà search đọc. */
class FakeStore extends MemoryExploreSource implements ExploreStore {
  saved: BuiltIndex | null = null;
  constructor(private readonly live: BuiltIndex) {
    super(live);
  }
  async replaceAll(index: BuiltIndex) {
    this.saved = index;
    this.live.docs = [...index.docs];
    return true;
  }
  async deleteDocuments(ids: string[]) {
    const before = this.live.docs.length;
    this.live.docs = this.live.docs.filter((d) => !ids.includes(d.id));
    return before - this.live.docs.length;
  }
}

function setup(hotels: ExploreHotel[], posts: ExplorePost[], hidden: string[] = []) {
  const store = new FakeStore(buildIndex([...hotels.map(hotelToObject), ...posts.map(postToObject)]));
  const catalog: ExploreCatalog = {
    listHotels: async () => ({ items: hotels, nextCursor: null }),
    listPosts: async () => ({ items: posts, nextCursor: null }),
    findVisiblePostIds: async (ids) => new Set(ids.filter((id) => !hidden.includes(id))),
  };
  return { store, catalog, explore: new ExploreUseCases(store, catalog) };
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

  it('tìm bài: phân trang, lọc postType, video kèm lộ trình chỉ một lần, bỏ bài ẩn', async () => {
    const trip = { destinationName: 'Đà Nẵng', daysCount: 3, estimatedCostPerPerson: 2_500_000 };
    const posts = [
      post('P1', 'Lịch trình Đà Nẵng 3N2Đ', { tripAttachment: trip, reactionTotal: 120 }),
      post('V1', 'Vlog Đà Nẵng 3 ngày', { postType: 'video', tripAttachment: trip }),
      post('P2', 'Review biển Đà Nẵng'),
      post('P3', 'Ăn gì ở Đà Nẵng'),
      post('P4', 'Đà Nẵng mùa mưa'),
    ];
    const { explore } = setup([hotel('H1', 'Vinpearl Đà Nẵng', 'Đà Nẵng')], posts, ['P4']);
    const first = await explore.searchPosts({ q: 'đà nẵng', postType: 'all', limit: 2 });
    expect(first.total).toBe(4); // V1 ở cả Lộ trình và Video, P4 bị ẩn, không có khách sạn
    expect(first.items).toHaveLength(2);
    const rest = await explore.searchPosts({ q: 'đà nẵng', postType: 'all', limit: 2, cursor: first.nextCursor! });
    expect(rest.nextCursor).toBeNull();
    const ids = [...first.items, ...rest.items].map((i) => i.refId);
    expect(new Set(ids)).toEqual(new Set(['P1', 'V1', 'P2', 'P3']));
    expect(first.items.find((i) => i.refId === 'P1')?.reason).toMatch(/^3 ngày · .*♥ 120$/);
    const videos = await explore.searchPosts({ q: 'đà nẵng', postType: 'video', limit: 20 });
    expect(videos.items.map((i) => i.refId)).toEqual(['V1']);
    const plans = await explore.searchPosts({ q: 'lịch trình đà nẵng dưới 2tr', postType: 'plan', limit: 20 });
    expect(plans).toMatchObject({ total: 0, items: [], nextCursor: null, understood: { budget: 2_000_000 } });
  });

  it('dựng lại chỉ mục từ cả hai nguồn', async () => {
    const { explore, store } = setup([hotel('H1', 'A', 'Huế')], [post('P1', 'B')]);
    expect(await explore.rebuildIndex()).toBe(2);
    expect(store.saved!.docs.map((d) => d.id)).toEqual(['hotel:H1', 'post:P1']);
  });

  describe('TF33: gỡ bài ẩn khỏi chỉ mục', () => {
    const trip = { destinationName: 'Đà Nẵng', daysCount: 3, estimatedCostPerPerson: 2_500_000 };
    const plans = [post('P1', 'Trọn bộ lịch trình Đà Nẵng 3N2Đ', { tripAttachment: trip }), post('P2', 'Lịch trình Đà Nẵng 3 ngày', { tripAttachment: trip })];
    const planTotal = async (explore: ExploreUseCases) =>
      (await explore.search({ q: 'lịch trình đà nẵng 3n2đ' })).sections.find((s) => s.kind === 'plan')!.total;

    it('ẩn bài rồi dropHidden: total giảm ngay, gọi lại không gỡ thêm', async () => {
      const hidden: string[] = [];
      const { explore } = setup([], plans, hidden);
      expect(await planTotal(explore)).toBe(2);
      hidden.push('P2');
      expect(await planTotal(explore)).toBe(2); // chưa gỡ: total còn dư bài ẩn (lỗi cũ)
      expect(await explore.dropHidden(['P2'])).toBe(1);
      expect(await planTotal(explore)).toBe(1);
      expect(await explore.dropHidden(['P2'])).toBe(0); // đã gỡ rồi: báo 0 để log không ghi "Đã gỡ" lần nữa
      expect(await planTotal(explore)).toBe(1);
    });

    it('bài còn hiện (vd vừa restore) thì không bị gỡ', async () => {
      const { explore } = setup([], plans);
      expect(await explore.dropHidden(['P1', 'P2'])).toBe(0);
      expect(await planTotal(explore)).toBe(2);
    });

    it('bài bị ẩn sau lúc job đọc mà bị ghi lại vẫn bị gỡ ngay sau khi dựng xong', async () => {
      const hidden: string[] = [];
      const { explore, store, catalog } = setup([], plans, hidden);
      catalog.listPosts = async () => {
        const page = { items: plans, nextCursor: null }; // job đọc lúc P2 còn hiện
        hidden.push('P2'); // admin ẩn P2 ngay sau đó
        return page;
      };
      expect(await explore.rebuildIndex()).toBe(2);
      expect(store.saved!.docs.map((d) => d.id)).toContain('post:P2'); // replaceAll đã ghi lại P2
      expect(await planTotal(explore)).toBe(1);
    });

    it('cả luồng: ẩn → gỡ trong vài giây; restore → bài quay lại ở lượt job kế tiếp (tua 10 phút bằng fake timer)', async () => {
      vi.useFakeTimers();
      try {
        const hidden: string[] = [];
        const { explore } = setup([], plans, hidden);
        const job = new RebuildExploreIndexJob({ APP_ROLE: 'worker' } as CoreEnv, explore);
        const consumer = new ExploreContentConsumer({ APP_ROLE: 'api' } as CoreEnv, {} as Redis, explore);
        const moderated = (action: string) =>
          consumer.route({ eventId: action, type: 'content.post.moderated', payload: { postId: 'P2', action } } as unknown as EventEnvelope);
        const minute = 60_000;

        job.onApplicationBootstrap(); // phút 0: worker khởi động, dựng chỉ mục lần đầu
        await vi.advanceTimersByTimeAsync(0);
        expect(await planTotal(explore)).toBe(2);

        await vi.advanceTimersByTimeAsync(2 * minute); // phút 2: admin ẩn P2, consumer nhận event
        hidden.push('P2');
        await moderated('hide');
        expect(await planTotal(explore)).toBe(1);

        await vi.advanceTimersByTimeAsync(3 * minute); // phút 5: admin khôi phục P2
        hidden.splice(0);
        await moderated('restore');
        expect(await planTotal(explore)).toBe(1); // consumer không thêm lại, chờ job

        await vi.advanceTimersByTimeAsync(5 * minute - 1); // ngay trước phút 10: job chưa chạy
        expect(await planTotal(explore)).toBe(1);
        await vi.advanceTimersByTimeAsync(1); // phút 10: job chạy lượt kế tiếp
        expect(await planTotal(explore)).toBe(2);
        job.onApplicationShutdown();
      } finally {
        vi.useRealTimers();
      }
    });

    it('dọn sau khi dựng lỗi thì vẫn giữ chỉ mục mới', async () => {
      const { explore, store, catalog } = setup([], plans);
      catalog.findVisiblePostIds = async () => {
        throw new Error('content down');
      };
      expect(await explore.rebuildIndex()).toBe(2);
      expect(store.saved!.docs).toHaveLength(2);
    });
  });
});
