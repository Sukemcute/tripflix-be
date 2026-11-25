import type { EventEnvelope } from '@tripflix/contracts';
import type { Redis } from 'ioredis';
import type { CoreEnv } from '../../../../platform/env.js';
import { DiscoveryEventsConsumer } from '../../consumers/discovery-events.consumer.js';
import type { RecommendIngestUseCases } from '../../recommend/application/ingest.use-cases.js';
import { buildIndex } from '../domain/explore/build.js';
import { RebuildExploreIndexJob } from '../jobs/rebuild-explore-index.job.js';
import { IndexHealth } from '../jobs/index-health.js';
import { MemoryExploreSource } from '../domain/explore/memory-source.js';
import type { BuiltIndex } from '../domain/explore/types.js';
import type { QueryGramRow } from '../domain/explore/vocab-gaps.js';
import { ExploreUseCases, hotelToObject, pointToObject, postToObject } from './explore.use-cases.js';
import { PLACE_SEEDS } from '../domain/place-seeds.js';
import type { PointOfInterestSeed } from '../domain/points-of-interest.js';
import type { ExploreCatalog, ExploreHotel, ExplorePost, ExploreStore } from './ports.js';
import type { JobRuns } from '../../jobs/job-runs.js';

const passThroughRuns = {
  track: (_job: string, _trigger: string, fn: () => Promise<unknown>) => fn(),
  getIntervalMs: (_job: string, fallback: number) => Promise.resolve(fallback),
} as unknown as JobRuns;

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
  authorId: 'U1',
  createdAt: new Date('2026-11-01T08:00:00Z'),
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
  /** Đếm câu tìm trong RAM, cùng phép cộng dồn với bảng search_query_grams. */
  readonly grams = new Map<string, QueryGramRow & { day: string }>();
  async recordQueryGrams(day: string, rows: QueryGramRow[]) {
    for (const r of rows) {
      const old = this.grams.get(`${day}|${r.gram}`);
      const samples = old ? [...old.samples, ...r.samples.filter((s) => !old.samples.includes(s))].slice(0, 5) : r.samples;
      this.grams.set(`${day}|${r.gram}`, { day, gram: r.gram, hits: (old?.hits ?? 0) + r.hits, samples });
    }
  }
  async listQueryGrams(since: string, minCount: number) {
    const sum = new Map<string, QueryGramRow>();
    for (const r of this.grams.values()) {
      if (r.day < since) continue;
      const s = sum.get(r.gram) ?? { gram: r.gram, hits: 0, samples: [] };
      sum.set(r.gram, { gram: r.gram, hits: s.hits + r.hits, samples: [...new Set([...s.samples, ...r.samples])].slice(0, 5) });
    }
    return [...sum.values()].filter((r) => r.hits >= minCount || r.gram.startsWith('#'));
  }
  async purgeQueryGrams() {
    return 0;
  }
}

function setup(hotels: ExploreHotel[], posts: ExplorePost[], hidden: string[] = [], points: PointOfInterestSeed[] = []) {
  const store = new FakeStore(buildIndex([...hotels.map(hotelToObject), ...posts.map(postToObject)]));
  const catalog: ExploreCatalog = {
    listHotels: async () => ({ items: hotels, nextCursor: null }),
    listPosts: async () => ({ items: posts, nextCursor: null }),
    findVisiblePostIds: async (ids) => new Set(ids.filter((id) => !hidden.includes(id))),
    getAuthorNames: async (ids) => new Map(ids.filter((id) => id === 'U1').map((id) => [id, 'Minh Anh'])),
  };
  const places = { listPlaces: async () => [...PLACE_SEEDS], listPoints: async () => points };
  return { store, catalog, places, explore: new ExploreUseCases(store, catalog, places) };
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

  it('bài video có poster thì kết quả tìm có ảnh bìa, không có thì null', () => {
    const url = 'https://media.tripflix.io.vn/staging/videos/V1/r1/poster_360.jpg';
    expect(postToObject(post('P1', 'Săn mây', { postType: 'video', posterUrl: url })).thumbnail).toBe(url);
    expect(postToObject(post('P2', 'Review quán')).thumbnail).toBeNull();
  });

  it('tìm theo nơi, ngân sách; bài bị ẩn không lọt ra kết quả', async () => {
    const trip = (d: number) => ({ destinationName: 'Đà Nẵng', daysCount: d, estimatedCostPerPerson: 2_500_000 });
    const { explore } = setup(
      [hotel('H1', 'Vinpearl Resort Đà Nẵng', 'Đà Nẵng', { slug: 'vinpearl-resort-da-nang-ab12' }), hotel('H2', 'Dalat Palace', 'Đà Lạt'), hotel('H3', 'Sang Resort', 'Đà Nẵng', { priceFrom: 9_000_000 })],
      [post('P1', 'Trọn bộ lịch trình Đà Nẵng 3N2Đ', { tripAttachment: trip(3) }), post('P2', 'Lịch trình Đà Nẵng 3 ngày', { tripAttachment: trip(3) })],
      ['P2'],
    );
    const stays = await explore.search({ q: 'khách sạn đà nẵng dưới 2tr' });
    expect(stays.understood).toMatchObject({ place: 'Đà Nẵng', budget: 2_000_000 });
    expect(stays.sections[0]).toMatchObject({ kind: 'stay', items: [{ id: 'hotel:H1', refId: 'H1', slug: 'vinpearl-resort-da-nang-ab12' }] });
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
    // Lộ trình duy nhất 2,5tr vượt ngân sách 2tr: không bao giờ là kết quả chính, chỉ là kết quả thay thế có ghi rõ đã nới ngân sách.
    const plans = await explore.searchPosts({ q: 'lịch trình đà nẵng dưới 2tr', postType: 'plan', limit: 20 });
    expect(plans).toMatchObject({ isFallback: true, fallbackRelaxed: ['budget'], nextCursor: null, understood: { budget: 2_000_000 } });
    expect(plans.items.map((i) => [i.refId, i.reason.includes('vượt ngân sách')])).toEqual([['P1', true]]);
  });

  it('TF95: article = lộ trình + bài viết, bỏ mọi video (kể cả video kèm lộ trình), trang đủ limit', async () => {
    const trip = { destinationName: 'Đà Nẵng', daysCount: 3, estimatedCostPerPerson: 2_500_000 };
    const posts = [
      post('P1', 'Lịch trình Đà Nẵng 3N2Đ', { tripAttachment: trip }),
      post('V1', 'Vlog lịch trình Đà Nẵng 3 ngày', { postType: 'video', tripAttachment: trip }),
      post('V2', 'Video biển Đà Nẵng', { postType: 'video' }),
      post('P2', 'Review biển Đà Nẵng'),
      post('P3', 'Ăn gì ở Đà Nẵng'),
      post('P4', 'Đà Nẵng mùa mưa'),
    ];
    const { explore } = setup([], posts);
    // V1 nằm trong vùng Lộ trình: lọc theo vùng thôi thì V1 lọt vào article.
    expect((await explore.searchPosts({ q: 'đà nẵng', postType: 'plan', limit: 20 })).items.map((i) => i.refId)).toContain('V1');
    const first = await explore.searchPosts({ q: 'đà nẵng', postType: 'article', limit: 2 });
    expect(first).toMatchObject({ total: 4, isFallback: false });
    expect(first.items).toHaveLength(2);
    const rest = await explore.searchPosts({ q: 'đà nẵng', postType: 'article', limit: 2, cursor: first.nextCursor! });
    expect(rest.items).toHaveLength(2);
    expect(rest.nextCursor).toBeNull();
    expect(new Set([...first.items, ...rest.items].map((i) => i.refId))).toEqual(new Set(['P1', 'P2', 'P3', 'P4']));

    // Kết quả thay thế ('mùa thu' không có trong dữ liệu): V1 có trong `all` nhưng không lọt vào article.
    const fallbackSetup = setup([], [posts[0]!, posts[1]!, post('P2', 'Review biển Đà Nẵng')]);
    const q = 'lịch trình đà nẵng mùa thu';
    const all = await fallbackSetup.explore.searchPosts({ q, postType: 'all', limit: 20 });
    expect(all.isFallback).toBe(true);
    expect(all.items.map((i) => i.refId)).toContain('V1');
    const article = await fallbackSetup.explore.searchPosts({ q, postType: 'article', limit: 20 });
    expect(article).toMatchObject({ isFallback: true, dropped: ['mùa thu'] });
    expect(article.items.map((i) => i.refId)).toEqual(['P1']);
  });

  it('TF95: item bài có số tim, bình luận, ngày đăng, tác giả (avatar null); khách sạn để null', async () => {
    const posts = [
      post('P1', 'Review biển Đà Nẵng', { reactionTotal: 120, commentCount: 8 }),
      post('P2', 'Ăn gì ở Đà Nẵng', { authorId: 'U-missing', createdAt: new Date('2026-10-02T00:00:00Z') }),
    ];
    const { explore } = setup([hotel('H1', 'Vinpearl Resort Đà Nẵng', 'Đà Nẵng')], posts);
    const page = await explore.searchPosts({ q: 'đà nẵng', postType: 'article', limit: 20 });
    expect(page.items.find((i) => i.refId === 'P1')).toMatchObject({
      likes: 120,
      comments: 8,
      createdAt: '2026-11-01T08:00:00.000Z',
      author: { id: 'U1', name: 'Minh Anh', avatarUrl: null },
    });
    expect(page.items.find((i) => i.refId === 'P2')).toMatchObject({ createdAt: '2026-10-02T00:00:00.000Z', author: { id: 'U-missing', name: null } });
    const explorePage = await explore.search({ q: 'đà nẵng' });
    const items = explorePage.sections.flatMap((s) => s.items);
    expect(items.find((i) => i.refId === 'H1')).toMatchObject({ likes: null, comments: null, createdAt: null, author: null });
    expect(items.find((i) => i.refId === 'P1')).toMatchObject({ slug: null, likes: 120, author: { name: 'Minh Anh' } });
  });

  it('tìm bài: không bài nào khớp đủ câu thì gợi ý theo phần hiểu được và nói rõ từ nào bị bỏ', async () => {
    const trip = { destinationName: 'Hà Nội', daysCount: 2, estimatedCostPerPerson: 1_800_000 };
    const posts = [post('P1', 'Hà Nội 2N1Đ phố cổ', { tripAttachment: trip }), post('P2', 'Ăn gì ở Hà Nội'), post('P3', 'Đà Nẵng mùa mưa'), post('P4', 'Hà Nội ẩn')];
    const { explore } = setup([], posts, ['P4']);
    // 'mùa thu' không có trong dữ liệu, 'hà nội' thì có: không để trang trắng.
    const page = await explore.searchPosts({ q: 'mùa thu hà nội', postType: 'all', limit: 20 });
    expect(page).toMatchObject({ isFallback: true, dropped: ['mùa thu'], understood: { place: 'Hà Nội' } });
    expect(new Set(page.items.map((i) => i.refId))).toEqual(new Set(['P1', 'P2'])); // P3 khác nơi, P4 bị ẩn
    // Khớp đủ thì không phải gợi ý.
    expect(await explore.searchPosts({ q: 'hà nội', postType: 'all', limit: 20 })).toMatchObject({ isFallback: false, dropped: [] });
    // Không hiểu gì (không nơi, không ý muốn) thì vẫn rỗng, không đoán bừa.
    expect(await explore.searchPosts({ q: 'zzzz', postType: 'all', limit: 20 })).toMatchObject({ total: 0, items: [], isFallback: false });
  });

  describe('TF102: khoảng trống từ vựng', () => {
    const flush = () => new Promise((resolve) => setImmediate(resolve));

    it('đếm n-gram mỗi lượt tìm và trang đầu tìm bài; lật trang không đếm', async () => {
      const { explore, store } = setup([hotel('H1', 'Vinpearl Đà Nẵng', 'Đà Nẵng')], [post('P1', 'Ăn gì ở Đà Nẵng')]);
      await explore.search({ q: 'quán nàng thơ đà nẵng' });
      await explore.searchPosts({ q: 'nàng thơ', postType: 'all', limit: 1 });
      await explore.searchPosts({ q: 'nàng thơ', postType: 'all', limit: 1, cursor: 'x' });
      await flush();
      const day = [...store.grams.values()][0]!.day;
      expect(store.grams.get(`${day}|#q`)!.hits).toBe(2);
      expect(store.grams.get(`${day}|nang tho`)).toMatchObject({ hits: 2, samples: ['quán nàng thơ đà nẵng', 'nàng thơ'] });
      // Nơi đã hiểu không vào seq nên không thành n-gram.
      expect([...store.grams.keys()].some((k) => k.includes('da nang'))).toBe(false);
    });

    it('vocabGaps: cụm người tìm dùng mà nội dung không có lên đầu, có câu mẫu', async () => {
      const { explore } = setup(
        [hotel('H1', 'Khách sạn Đà Lạt Center', 'Lâm Đồng', { city: 'Đà Lạt' })],
        [post('P1', 'Nàng tiên cá ở Đà Lạt'), post('P2', 'Thơ tình Đà Lạt'), post('P3', 'Quán đẹp ở Đà Lạt')],
      );
      for (const q of ['quán nàng thơ đà lạt', 'cafe nàng thơ', 'nàng thơ đà lạt', 'quán đẹp đà lạt']) await explore.search({ q });
      await flush();
      const page = await explore.vocabGaps({ days: 7, limit: 10, minCount: 2 });
      expect(page).toMatchObject({ days: 7, queries: 4 });
      expect(page.items[0]).toMatchObject({ gram: 'nang tho', n: 2, queryHits: 3, contentCount: 0 });
      expect(page.items[0]!.samples).toEqual(expect.arrayContaining(['quán nàng thơ đà lạt', 'cafe nàng thơ']));
    });

    it('ghi đếm lỗi không làm hỏng lượt tìm', async () => {
      const { explore, store } = setup([hotel('H1', 'Vinpearl Đà Nẵng', 'Đà Nẵng')], []);
      store.recordQueryGrams = () => Promise.reject(new Error('db down'));
      await expect(explore.search({ q: 'khách sạn đà nẵng' })).resolves.toMatchObject({ understood: { place: 'Đà Nẵng' } });
      await flush();
    });
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
        const env = { APP_ROLE: 'worker', NODE_ENV: 'test' } as CoreEnv;
        const job = new RebuildExploreIndexJob(
          { APP_ROLE: 'worker' } as CoreEnv, explore, new IndexHealth(env, {} as Redis), passThroughRuns,
        );
        const recommend = { ingest: () => Promise.resolve() } as unknown as RecommendIngestUseCases;
        const consumer = new DiscoveryEventsConsumer({ APP_ROLE: 'api' } as CoreEnv, {} as Redis, explore, recommend);
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

  describe('điểm OSM trong chỉ mục', () => {
    const poi = (id: string, name: string, kind: PointOfInterestSeed['kind'], tags: string[] = []): PointOfInterestSeed => ({
      id, name, kind, lat: 11.94, lng: 108.45, cityId: 'da-lat', tags, popularity: 0.5,
    });
    const points = [poi('osm:node/1', 'Kokoro Coffee', 'cafe', ['indoor']), poi('osm:node/2', 'Bảo tàng Lâm Đồng', 'see', ['museum']), poi('osm:node/3', 'Nhà nghỉ Hoa', 'lodging')];

    it('map quán, điểm tham quan sang đúng vùng và nơi; bỏ chỗ ở ngoài Tripflix', () => {
      expect(pointToObject(points[0]!, 'Đà Lạt')).toMatchObject({ id: 'poi:osm:node/1', kind: 'cafe', place: 'Đà Lạt', lat: 11.94, lon: 108.45 });
      expect(pointToObject(points[2]!, 'Đà Lạt')).toBeNull();
    });

    it('dựng chỉ mục kèm điểm OSM rồi tìm được quán cà phê và bảo tàng theo câu tiếng Việt', async () => {
      const { explore, store } = setup([], [], [], points);
      expect(await explore.rebuildIndex()).toBe(2);
      expect(store.saved!.docs.map((d) => d.id)).toEqual(['poi:osm:node/1', 'poi:osm:node/2']);
      const cafe = await explore.search({ q: 'cà phê đà lạt' });
      expect(cafe.sections.find((s) => s.kind === 'cafe')!.items.map((i) => i.title)).toEqual(['Kokoro Coffee']);
      const museum = await explore.search({ q: 'bảo tàng đà lạt' });
      expect(museum.sections.find((s) => s.kind === 'see')!.items.map((i) => i.title)).toEqual(['Bảo tàng Lâm Đồng']);
    });

    it('searchPlaces: một loại, phân trang, kèm ghi nguồn OSM; không khớp đủ câu thì trả kết quả thay thế cùng loại', async () => {
      const many = Array.from({ length: 3 }, (_, i) => poi(`osm:node/${10 + i}`, `Cafe Số ${i + 1}`, 'cafe'));
      const { explore } = setup([], [], [], [...points, ...many]);
      await explore.rebuildIndex();
      const first = await explore.searchPlaces({ q: 'cafe đà lạt', kind: 'cafe', limit: 2 });
      expect(first.items.every((i) => i.kind === 'cafe')).toBe(true);
      expect(first).toMatchObject({ total: 4, isFallback: false, attribution: '© OpenStreetMap contributors (ODbL)' });
      const second = await explore.searchPlaces({ q: 'cafe đà lạt', kind: 'cafe', cursor: first.nextCursor!, limit: 2 });
      expect([...first.items, ...second.items].map((i) => i.id)).toHaveLength(4);
      expect(second.nextCursor).toBeNull();
      const relaxed = await explore.searchPlaces({ q: 'cafe yên tĩnh đà lạt', kind: 'cafe', limit: 10 });
      expect(relaxed.isFallback).toBe(true);
      expect(relaxed.dropped).toContain('yên tĩnh');
      expect((await explore.searchPlaces({ q: 'cafe đà lạt', kind: 'stay', limit: 10 })).attribution).toBeNull();
    });
  });

  describe('TF108: sort cho searchPosts', () => {
    it('relevance / recent / trending: giữ total, phân trang đúng, fallback relevance khi đọc điểm lỗi', async () => {
      const posts = [
        post('P1', 'Kinh nghiệm Đà Lạt cũ', { createdAt: new Date('2026-10-01T00:00:00Z'), reactionTotal: 100 }),
        post('P2', 'Kinh nghiệm Đà Lạt mới nhất', { createdAt: new Date('2026-11-15T00:00:00Z'), reactionTotal: 5 }),
        post('P3', 'Kinh nghiệm Đà Lạt giữa', { createdAt: new Date('2026-11-01T00:00:00Z'), reactionTotal: 20 }),
      ];
      const { store, catalog, places } = setup([], posts);
      const findPostScores = vi.fn(async (_builder: string, ids: string[]) => {
        expect(ids).toHaveLength(3);
        return new Map([
          ['P3', 0.95],
          ['P1', 0.4],
          // P2 chưa có điểm -> 0
        ]);
      });
      const explore = new ExploreUseCases(store, catalog, places, { findPostScores });
      await explore.rebuildIndex();

      const rel = await explore.searchPosts({ q: 'kinh nghiệm đà lạt', postType: 'all', sort: 'relevance', limit: 10 });
      expect(rel.total).toBe(3);

      const rec = await explore.searchPosts({ q: 'kinh nghiệm đà lạt', postType: 'all', sort: 'recent', limit: 2 });
      expect(rec.total).toBe(3);
      expect(rec.items.map((i) => i.refId)).toEqual(['P2', 'P3']);
      const rec2 = await explore.searchPosts({ q: 'kinh nghiệm đà lạt', postType: 'all', sort: 'recent', cursor: rec.nextCursor!, limit: 2 });
      expect(rec2.items.map((i) => i.refId)).toEqual(['P1']);

      const tr = await explore.searchPosts({ q: 'kinh nghiệm đà lạt', postType: 'all', sort: 'trending', limit: 10 });
      expect(tr.total).toBe(3);
      expect(tr.items.map((i) => i.refId)).toEqual(['P3', 'P1', 'P2']);

      // Đọc điểm lỗi -> log warn và giữ thứ tự relevance, không làm hỏng lượt tìm
      findPostScores.mockRejectedValueOnce(new Error('pg timeout'));
      const errFallback = await explore.searchPosts({ q: 'kinh nghiệm đà lạt', postType: 'all', sort: 'trending', limit: 10 });
      expect(errFallback.items.map((i) => i.refId)).toEqual(rel.items.map((i) => i.refId));
    });
  });

  describe('real-time syncPost', () => {
    it('upsert khi bài công khai, xoá khi bài bị ẩn; không đọc điểm hot (chỉ số nhanh không vào chỉ mục)', async () => {
      const p1 = post('P1', 'Review Phú Quốc mới', { reactionTotal: 42, commentCount: 7 });
      const { store, catalog, places } = setup([], [p1]);
      let isVisible = true;
      catalog.getVisiblePosts = vi.fn(async (ids: string[]) => (isVisible && ids.includes('P1') ? [p1] : []));
      const upsertDocuments = vi.fn(async () => 1);
      const tsStore: ExploreStore = Object.assign(store, { upsertDocuments });
      const findPostScores = vi.fn(async () => new Map([['P1', 0.85]]));
      const explore = new ExploreUseCases(tsStore, catalog, places, { findPostScores });

      expect(await explore.syncPost('P1')).toBe('upserted');
      expect(upsertDocuments).toHaveBeenCalledWith([expect.objectContaining({ id: 'post:P1' })]);
      expect(findPostScores).not.toHaveBeenCalled();

      isVisible = false;
      expect(await explore.syncPost('P1')).toBe('deleted');
    });

    it('hasIndex: hỏi store; store không khai báo (Postgres) thì coi như chưa có', async () => {
      const { store, catalog, places } = setup([], []);
      expect(await new ExploreUseCases(store, catalog, places).hasIndex()).toBe(false);
      const tsStore: ExploreStore = Object.assign(store, { hasIndex: vi.fn(async () => true) });
      expect(await new ExploreUseCases(tsStore, catalog, places).hasIndex()).toBe(true);
    });
  });
});
