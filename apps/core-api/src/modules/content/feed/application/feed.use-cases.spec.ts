import { describe, expect, it, vi } from 'vitest';
import type { MediaFacade, PlaybackInfo } from '../../media/media.facade.js';
import type { FeedCursor } from '../domain/feed-cursor.js';
import { FEED_FIRST_PAGE_TTL_SECONDS, FeedUseCases } from './feed.use-cases.js';
import type { FeedPageCache, FeedPostRow, FeedStore, SharedFeedPage } from './ports.js';

const row = (id: string): FeedPostRow => ({
  id,
  authorId: `author-${id}`,
  title: `Bài ${id}`,
  body: '',
  hashtags: [],
  mediaIds: [`media-${id}`],
  tripAttachment: null,
  reactionTotal: 1,
  commentCount: 0,
  bookmarkCount: 0,
  shareCount: 0,
  cursorAt: '2026-11-11T00:00:00.000000Z',
});

const playback = (id: string): PlaybackInfo => ({
  hlsUrl: `https://cdn/${id}/master.m3u8`,
  posters: { w360: 'a', w540: 'b', w720: 'c' },
  durationSec: 10,
  aspect: '9:16',
  levels: [360],
});

function setup(cache?: FeedPageCache) {
  const store = {
    listPlayablePosts: vi.fn(() => Promise.resolve([row('p1'), row('p2')])),
    listForYouPosts: vi.fn(() => Promise.resolve([row('p1'), row('p2')])),
    listHotPosts: vi.fn(() => Promise.resolve([row('p2'), row('p1')])),
    listSavedPlayablePosts: vi.fn(() => Promise.resolve([row('p2')])),
    findLikedPostIds: vi.fn((userId: string) => Promise.resolve(userId === 'u1' ? ['p1'] : [])),
    findSavedPostIds: vi.fn(() => Promise.resolve([])),
  } satisfies FeedStore;
  const media = {
    getPlayback: vi.fn((ids: string[]) => Promise.resolve(Object.fromEntries(ids.map((id) => [id, playback(id)])))),
  } as unknown as MediaFacade;
  // Seed cố định (0) để khoá cache đoán trước được.
  return { store, feed: new FeedUseCases(store, media, undefined, cache, () => 0) };
}

function memoryCache(): FeedPageCache & { set: ReturnType<typeof vi.fn> } {
  const entries = new Map<string, string>();
  return {
    get: <Card>(key: string) => {
      const raw = entries.get(key);
      return Promise.resolve(raw ? (JSON.parse(raw) as SharedFeedPage<Card>) : null);
    },
    set: vi.fn((key: string, page: SharedFeedPage<unknown>) => {
      entries.set(key, JSON.stringify(page));
      return Promise.resolve();
    }),
  };
}

describe('FeedUseCases cache trang đầu', () => {
  it('nhiều người mở trang đầu cùng lúc chỉ đọc database một lần, rồi lấy từ cache', async () => {
    const cache = memoryCache();
    const { store, feed } = setup(cache);

    await Promise.all(Array.from({ length: 10 }, () => feed.getPage({ limit: 10, after: null, viewerId: null })));
    const later = await feed.getPage({ limit: 10, after: null, viewerId: null });

    expect(store.listForYouPosts).toHaveBeenCalledTimes(1);
    expect(cache.set).toHaveBeenCalledWith('feed:first-page:v3:for_you:0:10', expect.anything(), FEED_FIRST_PAGE_TTL_SECONDS);
    expect(later.items.map((item) => item.postId)).toEqual(['p1', 'p2']);
    expect(later.items[0]?.viewerState).toBeNull();
  });

  it('phần chung lấy từ cache nhưng thích, lưu vẫn đúng của từng người xem', async () => {
    const { store, feed } = setup(memoryCache());

    const mine = await feed.getPage({ limit: 10, after: null, viewerId: 'u1' });
    const theirs = await feed.getPage({ limit: 10, after: null, viewerId: 'u2' });

    expect(store.listForYouPosts).toHaveBeenCalledTimes(1);
    expect(mine.items.map((item) => item.viewerState?.liked)).toEqual([true, false]);
    expect(theirs.items.map((item) => item.viewerState?.liked)).toEqual([false, false]);
  });

  it('tab hot và for_you cache riêng', async () => {
    const { store, feed } = setup(memoryCache());

    const hot = await feed.getPage({ tab: 'hot', limit: 10, after: null, viewerId: null });
    await feed.getPage({ limit: 10, after: null, viewerId: null });

    expect(hot.items.map((item) => item.postId)).toEqual(['p2', 'p1']);
    expect(store.listHotPosts).toHaveBeenCalledTimes(1);
    expect(store.listForYouPosts).toHaveBeenCalledTimes(1);
  });

  it('mỗi seed một khoá cache; trang sau giữ seed và mốc giờ của trang đầu', async () => {
    const cache = memoryCache();
    const store = setup().store;
    store.listForYouPosts.mockResolvedValue([
      { ...row('p1'), rank: 0.5 },
      { ...row('p2'), rank: 0.25 },
      { ...row('p3'), rank: 0.1 },
    ]);
    const media = {
      getPlayback: vi.fn((ids: string[]) => Promise.resolve(Object.fromEntries(ids.map((id) => [id, playback(id)])))),
    } as unknown as MediaFacade;
    const seeds = [0.99, 0.01];
    const feed = new FeedUseCases(store, media, undefined, cache, () => seeds.shift() ?? 0);

    const first = await feed.getPage({ limit: 2, after: null, viewerId: null });
    await feed.getPage({ limit: 2, after: null, viewerId: null });

    expect(cache.set.mock.calls.map(([key]) => key)).toEqual([
      'feed:first-page:v3:for_you:15:2',
      'feed:first-page:v3:for_you:0:2',
    ]);
    // Id giả không phải UUID nên đọc thẳng JSON thay vì decodeFeedCursor (hàm đó kiểm UUID).
    const cursor = JSON.parse(Buffer.from(first.nextCursor ?? '', 'base64url').toString('utf8')) as FeedCursor;
    expect(cursor).toMatchObject({ id: 'p2', rank: 0.25, seed: 15 });
    expect(cursor.asOf).toMatch(/Z$/);
    store.listForYouPosts.mockClear();
    await feed.getPage({ limit: 2, after: cursor, viewerId: null });
    expect(store.listForYouPosts).toHaveBeenCalledWith(expect.objectContaining({ seed: 15, asOf: cursor.asOf }));
  });

  it('cursor for_you cũ (chưa có rank) và trang tác giả vẫn mới nhất trước', async () => {
    const { store, feed } = setup();

    await feed.getPage({ limit: 10, after: { at: '2026-11-11T00:00:00.000000Z', id: 'p0' }, viewerId: null });
    await feed.getPage({ limit: 10, after: null, viewerId: null, authorId: 'a1' });

    expect(store.listPlayablePosts).toHaveBeenCalledTimes(2);
    expect(store.listForYouPosts).not.toHaveBeenCalled();
  });

  it('trang sau (có con trỏ) luôn đọc database, không cache', async () => {
    const cache = memoryCache();
    const { store, feed } = setup(cache);
    const after = { at: '2026-11-11T00:00:00.000000Z', id: 'p0', rank: 0.2, seed: 3, asOf: '2026-11-13T00:00:00.000Z' };

    await feed.getPage({ limit: 10, after, viewerId: null });
    await feed.getPage({ limit: 10, after, viewerId: null });

    expect(store.listForYouPosts).toHaveBeenCalledTimes(2);
    expect(cache.set).not.toHaveBeenCalled();
  });

  it('Redis lỗi thì feed vẫn trả từ database', async () => {
    const broken: FeedPageCache = {
      get: () => Promise.reject(new Error('redis down')),
      set: () => Promise.reject(new Error('redis down')),
    };
    const { store, feed } = setup(broken);

    const page = await feed.getPage({ limit: 10, after: null, viewerId: 'u1' });

    expect(page.items.map((item) => item.postId)).toEqual(['p1', 'p2']);
    expect(store.listForYouPosts).toHaveBeenCalledTimes(1);
  });
});

describe('FeedUseCases Reels đã lưu', () => {
  it('đọc bài đã lưu của đúng người xem, không đụng cache và trả saved=true', async () => {
    const cache = memoryCache();
    const { store, feed } = setup(cache);
    (store.findSavedPostIds as ReturnType<typeof vi.fn>).mockResolvedValue(['p2']);

    const page = await feed.getPage({ limit: 10, after: null, viewerId: 'u2', isSavedOnly: true });

    expect(store.listSavedPlayablePosts).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u2' }));
    expect(store.listPlayablePosts).not.toHaveBeenCalled();
    expect(store.listForYouPosts).not.toHaveBeenCalled();
    expect(cache.set).not.toHaveBeenCalled();
    expect(page.items.map((item) => item.postId)).toEqual(['p2']);
    expect(page.items[0]?.viewerState).toEqual({ liked: false, saved: true });
  });

  it('không có người xem thì từ chối thay vì trả feed chung', async () => {
    const { store, feed } = setup();
    await expect(feed.getPage({ limit: 10, after: null, viewerId: null, isSavedOnly: true })).rejects.toThrow();
    expect(store.listSavedPlayablePosts).not.toHaveBeenCalled();
  });
});
