import type { EventEnvelope } from '@tripflix/contracts';
import { STREAMS, type EventBus } from '@tripflix/event-bus';
import { ExploreController } from '../api/explore.controller.js';
import type { ExploreResultPage, ExploreUseCases, PostSearchPage } from './explore.use-cases.js';
import { SearchEventsPublisher } from './search-events.publisher.js';

const U = '11111111-1111-4111-8111-111111111111';
const USER = { userId: U, role: 'member' as const, sid: 's', exp: 0 };
const understood = (over: Partial<ExploreResultPage['understood']> = {}): ExploreResultPage['understood'] => ({
  place: 'Đà Lạt', intents: ['food'], budget: 1_500_000.4, days: null, names: [], phrases: [], fixed: {}, ...over,
});

function setup(publish: EventBus['publish'] = vi.fn().mockResolvedValue('1-0')) {
  const bus = { publish } as EventBus;
  const publisher = new SearchEventsPublisher(bus);
  const explorePage: ExploreResultPage = {
    understood: understood(),
    nearUser: false,
    sections: [{ kind: 'stay', label: 'Ở đâu', total: 3, items: [] }, { kind: 'post', label: 'Bài viết', total: 2, items: [] }],
    fallback: null,
    suggest: [],
    dropped: [],
  };
  const postsPage: PostSearchPage = { understood: understood(), items: [], total: 7, nextCursor: '20', dropped: [], isFallback: false, fallbackRelaxed: [] };
  const explore = { search: vi.fn().mockResolvedValue(explorePage), searchPosts: vi.fn().mockResolvedValue(postsPage) } as unknown as ExploreUseCases;
  return { bus, publish, controller: new ExploreController(explore, publisher), explorePage };
}

const published = (publish: EventBus['publish']) => (publish as ReturnType<typeof vi.fn>).mock.calls.map((c) => c as [string, EventEnvelope]);

describe('Phát sự kiện tìm kiếm', () => {
  it('POST /search có user: discovery.search.performed, nơi đổi về id PLACES, không có q/loc', async () => {
    const { controller, publish, explorePage } = setup();
    const body = { q: 'ăn gì đà lạt dưới 1tr5', loc: { lat: 10, lng: 106 } };
    expect(await controller.search(body, USER)).toBe(explorePage);
    const [stream, envelope] = published(publish)[0]!;
    expect(stream).toBe(STREAMS.discovery);
    expect(envelope).toMatchObject({ type: 'discovery.search.performed', version: 1, userId: U, producer: 'core-api' });
    expect(envelope.payload).toEqual({ userId: U, surface: 'explore', placeIds: ['da-lat'], intent: 'food', budgetMax: 1_500_000, postType: null, resultCount: 5 });
    expect(JSON.stringify(envelope)).not.toMatch(/ăn gì|"lat"|106/);
  });

  it('POST /search/posts: chỉ trang đầu; postType all → null', async () => {
    const { controller, publish } = setup();
    await controller.searchPosts({ q: 'đà lạt', postType: 'video' }, USER);
    await controller.searchPosts({ q: 'đà lạt', postType: 'all', cursor: '20' }, USER);
    await controller.searchPosts({ q: 'đà lạt' }, USER);
    expect(published(publish).map(([, e]) => [e.payload.surface, e.payload.postType, e.payload.resultCount])).toEqual([
      ['posts', 'video', 7],
      ['posts', null, 7],
    ]);
  });

  it('khách: kết quả y như trước, không phát', async () => {
    const { controller, publish, explorePage } = setup();
    expect(await controller.search({ q: 'đà lạt' }, undefined)).toBe(explorePage);
    expect(publish).not.toHaveBeenCalled();
  });

  it('Redis lỗi: không chặn, không làm hỏng response', async () => {
    const { controller, explorePage } = setup(vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    expect(await controller.search({ q: 'đà lạt' }, USER)).toBe(explorePage);
    await new Promise((r) => setImmediate(r));
  });

  it('không hiểu được nơi: placeIds rỗng; nơi không có trong PLACES cũng rỗng', () => {
    const { publish } = setup();
    const publisher = new SearchEventsPublisher({ publish } as EventBus);
    publisher.searchPerformed(U, { surface: 'explore', understood: understood({ place: null, intents: [], budget: null }), postType: null, resultCount: 0 });
    publisher.searchPerformed(U, { surface: 'explore', understood: understood({ place: 'Sa Pa' }), postType: null, resultCount: 0 });
    expect(published(publish).map(([, e]) => e.payload.placeIds)).toEqual([[], []]);
  });

  it('stays: discovery.stays.searched đủ trường', () => {
    const { publish } = setup();
    new SearchEventsPublisher({ publish } as EventBus).staysSearched(U, {
      placeId: 'lam-dong', checkIn: '2026-12-01', checkOut: '2026-12-03', adults: 2, rooms: null, minStars: 4, priceMax: null, resultCount: 9,
    });
    expect(published(publish)[0]![1]).toMatchObject({ type: 'discovery.stays.searched', payload: { placeId: 'lam-dong', minStars: 4, resultCount: 9 } });
  });
});
