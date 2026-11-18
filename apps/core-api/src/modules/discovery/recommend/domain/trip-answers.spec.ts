import { tripProfileV1 } from './builders/trip-profile.js';
import type { PostMeta, RawRow } from './contracts.js';
import { answerLive } from './live-answers.js';

const NOW = new Date('2026-11-13T00:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
const row = (r: Partial<RawRow>): RawRow => ({
  actorType: 'user',
  actorId: 'u1',
  kind: 'reaction',
  refId: Math.random().toString(36),
  targetType: null,
  targetId: null,
  value: null,
  isRemoved: false,
  detail: null,
  occurredAt: daysAgo(0),
  ...r,
});
const posts: Record<string, PostMeta> = {
  nt1: { postId: 'nt1', authorId: 'a1', postType: 'video', tags: ['bien'], placeId: 'nha-trang' },
  nt2: { postId: 'nt2', authorId: 'a1', postType: 'video', tags: ['streetfood'], placeId: 'nha-trang' },
  dl1: { postId: 'dl1', authorId: 'a2', postType: 'vlog', tags: ['cafe'], placeId: 'da-lat' },
};
const react = (postId: string, d: number, kind: RawRow['kind'] = 'reaction') => row({ kind, targetType: 'post', targetId: postId, occurredAt: daysAgo(d) });
const search = (placeId: string, d: number) => row({ kind: 'search', targetType: 'place', targetId: placeId, occurredAt: daysAgo(d) });

describe('trip_profile@v1', () => {
  const build = async (rows: RawRow[]) => (await tripProfileV1.build([{ userId: 'u1', rows, posts, productPlaces: {} }], NOW))[0]!.features as never as {
    answers: Record<string, Record<string, number>>;
    evidence: Record<string, number>;
    creators: Record<string, number>;
  };

  it('mỗi câu hỏi một histogram trên ngăn của bài; lưu nặng hơn thả tim', async () => {
    const f = await build([react('nt1', 0, 'bookmark'), react('dl1', 0)]);
    expect(f.answers.place).toEqual({ 'place:nha-trang': 3.6, 'place:khanh-hoa': 3.6, 'place:da-lat': 1.8, 'place:lam-dong': 1.8 });
    expect(f.answers.exp).toEqual({ 'exp:bien': 2, 'exp:cafe': 1 });
    expect(f.evidence).toEqual({ place: 6, exp: 6 });
    expect(f.creators).toEqual({ a1: 4, a2: 2 });
    expect(tripProfileV1.featuresSchema.safeParse(f).success).toBe(true);
  });

  it('tìm kiếm không vào sở thích dài hạn (lỗi 225 lượt tìm Hà Nội)', async () => {
    const f = await build([react('nt1', 1), ...Array.from({ length: 50 }, (_, i) => search('ha-noi', i / 10))]);
    expect(Object.keys(f.answers.place!)).toEqual(['place:nha-trang', 'place:khanh-hoa']);
  });

  it('nhạt dần: 14 ngày còn một nửa; bỏ dòng đã gỡ', async () => {
    const f = await build([react('dl1', 14), react('nt1', 0, 'reaction'), { ...react('nt2', 0), isRemoved: true }]);
    expect(f.answers.exp).toEqual({ 'exp:cafe': 0.5, 'exp:bien': 1 });
  });
});

describe('answerLive', () => {
  const live = (rows: RawRow[], productPlaces: Record<string, string> = {}) => answerLive({ rows, posts, productPlaces, now: NOW });

  it('không có gì → mơ', () => {
    expect(live([react('dl1', 3)]).stage).toBe('dreaming');
  });

  it('2 lượt tìm gần đây → lên kế hoạch, nhắm nơi đó kèm tỉnh cha; tìm cũ thì nhạt', () => {
    const a = live([search('nha-trang', 0.2), search('nha-trang', 0.5)]);
    expect(a.stage).toBe('planning');
    expect(Object.keys(a.exploring)).toEqual(['place:nha-trang', 'place:khanh-hoa']);
    expect(live([search('nha-trang', 6), search('nha-trang', 7)]).stage).toBe('dreaming');
  });

  it('một lượt tìm phòng đủ để lên kế hoạch; đọc ngân sách, số người, số ngày', () => {
    const a = live([
      row({
        kind: 'stays_search',
        targetType: 'place',
        targetId: 'da-lat',
        detail: { checkIn: '2026-11-20', checkOut: '2026-11-22', adults: 2, rooms: 1, minStars: null, priceMax: 500_000 },
      }),
    ]);
    expect(a).toMatchObject({ stage: 'planning', budget: { 'cost:binh_dan': 1 }, party: { 'with:cap_doi': 1 }, len: { 'len:vua': 1 } });
  });

  it('thích 2 bài cùng nơi trong 1 ngày → đang tìm hiểu nơi đó', () => {
    const a = live([react('nt1', 0.2), react('nt2', 0.4)]);
    expect(a.exploring['place:nha-trang']).toBeGreaterThan(1.5);
    expect(a.stage).toBe('planning');
  });

  it('giai đoạn theo ngày của đơn: sắp đi / đang đi / vừa về / quá 14 ngày thì thôi; đơn đã huỷ bỏ qua', () => {
    const order = (date: string, removed = false) =>
      row({ kind: 'order_item', targetType: 'hotel', targetId: 'H1', occurredAt: daysAgo(20), isRemoved: removed, detail: { date, nights: 2 } });
    const places = { H1: 'nha-trang' };
    expect(live([order('2026-11-16')], places)).toMatchObject({ stage: 'upcoming', trip: { placeId: 'nha-trang', hotelId: 'H1' } });
    expect(live([order('2026-11-12')], places).stage).toBe('on_trip');
    expect(live([order('2026-11-05')], places).stage).toBe('after_trip');
    expect(live([order('2026-10-20')], places).stage).toBe('dreaming');
    expect(live([order('2026-11-16', true)], places).stage).toBe('dreaming');
  });
});
