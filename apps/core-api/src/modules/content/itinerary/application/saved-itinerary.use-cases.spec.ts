import { describe, expect, it, vi } from 'vitest';
import type { SavedItineraryRecord } from '../../db/schema/index.js';
import { EmptyItineraryError, SavedItineraryNotFoundError, SavedItineraryUseCases, type ReelForItinerary, type SavedItineraryStore } from './saved-itinerary.use-cases.js';

const USER = 'u1';
const reel = (over: Partial<ReelForItinerary> = {}): ReelForItinerary => ({
  id: 'post-1',
  title: 'Đà Lạt 2 ngày',
  authorId: 'author',
  status: 'published',
  visibility: 'public',
  tripAttachment: { items: [{ day: 1, title: 'Hồ Xuân Hương' }] },
  ...over,
});

function setup(found: ReelForItinerary | null = reel()) {
  const store = {
    listOfUser: vi.fn(async () => []),
    findOfUser: vi.fn(async () => null),
    insert: vi.fn(async (userId: string, draft: object) => ({ id: 'it-1', userId, ...draft }) as unknown as SavedItineraryRecord),
    update: vi.fn(async () => null as SavedItineraryRecord | null),
    delete: vi.fn(async () => false),
    findReel: vi.fn(async () => found),
  } satisfies SavedItineraryStore;
  return { store, useCases: new SavedItineraryUseCases(store) };
}

describe('SavedItineraryUseCases (TF105)', () => {
  it('lưu từ reel công khai: bản sao kèm link reel gốc', async () => {
    const { useCases, store } = setup();
    await useCases.save(USER, { source: 'reel', postId: 'post-1' });
    expect(store.insert).toHaveBeenCalledWith(USER, expect.objectContaining({ source: 'reel', sourcePostId: 'post-1', daysCount: 1 }));
  });

  it('reel riêng tư hoặc chưa đăng của người khác thì như không có', async () => {
    for (const found of [reel({ visibility: 'private' }), reel({ status: 'draft' }), null]) {
      const { useCases, store } = setup(found);
      await expect(useCases.save(USER, { source: 'reel', postId: 'post-1' })).rejects.toBeInstanceOf(SavedItineraryNotFoundError);
      expect(store.insert).not.toHaveBeenCalled();
    }
  });

  it('tác giả lưu được reel riêng tư của chính mình', async () => {
    const { useCases, store } = setup(reel({ authorId: USER, visibility: 'private' }));
    await useCases.save(USER, { source: 'reel', postId: 'post-1' });
    expect(store.insert).toHaveBeenCalledTimes(1);
  });

  it('lưu từ Tripi và từ màn tự lên lộ trình đi qua bộ đổi dữ liệu', async () => {
    const { useCases, store } = setup();
    await useCases.save(USER, { source: 'tripi', trip: { place: 'Huế', days: [[{ id: 'a', name: 'Đại Nội' }]] } });
    await useCases.save(USER, { source: 'builder', builder: { items: [{ kind: 'activity', date: '2026-12-01', title: 'Bún bò' }] } });
    expect(store.insert.mock.calls.map(([, draft]) => (draft as { source: string }).source)).toEqual(['tripi', 'builder']);
  });

  it('sửa: số ngày không nhỏ hơn ngày lớn nhất có điểm; lộ trình của người khác trả 404', async () => {
    const { useCases, store } = setup();
    await expect(useCases.update(USER, 'it-x', { items: [{ day: 3, title: 'A' }], daysCount: 1 })).rejects.toBeInstanceOf(SavedItineraryNotFoundError);
    expect(store.update).toHaveBeenCalledWith(USER, 'it-x', { items: [{ day: 3, title: 'A' }], daysCount: 3 });
  });

  it('sửa thành không còn điểm nào thì từ chối', async () => {
    const { useCases } = setup();
    await expect(useCases.update(USER, 'it-1', { items: [{ day: 1, title: '  ' }] })).rejects.toBeInstanceOf(EmptyItineraryError);
  });

  it('xoá lộ trình không có thì 404', async () => {
    const { useCases } = setup();
    await expect(useCases.remove(USER, 'nope')).rejects.toBeInstanceOf(SavedItineraryNotFoundError);
  });
});
