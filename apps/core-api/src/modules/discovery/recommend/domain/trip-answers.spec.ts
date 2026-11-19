import { tripProfileV1 } from './builders/trip-profile.js';
import type { PostMeta, RawRow } from './contracts.js';
import { answerLive } from './live-answers.js';
import { tripRankerV1 } from './rankers/trip-v1.js';

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

  it('xem reels: ≥ 80% ngang comment (3), xem thật 1, lướt < 2 s trừ nhẹ và không tính là dấu hiệu', async () => {
    const view = (postId: string, value: number | null, watchedMs: number, isQualified: boolean) =>
      row({ kind: 'view_post', targetType: 'post', targetId: postId, refId: postId, value, detail: { watchedMs, isQualified } });
    const f = await build([view('nt1', 0.95, 28_500, true), view('dl1', 0.5, 15_000, true)]);
    expect(f.answers.exp).toEqual({ 'exp:bien': 3 * 0.5, 'exp:cafe': 1 * 0.5 }); // × độ tin thuộc ngăn (tag: 0,5)
    expect(f.evidence.exp).toBe(4);
    const skipped = await build([react('nt1', 0), view('nt2', 0.03, 900, false)]);
    expect(skipped.answers.place!['place:nha-trang']).toBeCloseTo(2 * 0.9 - 0.5 * 0.9, 4);
    expect(skipped.evidence.place).toBe(2);
    const onlySkip = await build([view('nt2', 0.03, 900, false)]);
    expect(onlySkip.answers.exp ?? {}).toEqual({});
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

  it('tìm lặp cùng nơi trong một giờ chỉ tính một lần: 150 lượt tìm Hà Nội không thắng vài lượt tìm phòng Nha Trang', () => {
    const at = (h: number, m: number) => new Date(NOW.getTime() - (h * 60 + m) * 60_000).toISOString();
    const spam = Array.from({ length: 150 }, (_, i) => row({ kind: 'search', targetType: 'place', targetId: 'ha-noi', occurredAt: at(3, i % 60) }));
    const stays = [1, 2].map((h) => row({ kind: 'stays_search', targetType: 'place', targetId: 'nha-trang', occurredAt: at(h, 0) }));
    const a = live([...spam, ...stays]);
    expect(a.exploring['place:ha-noi']).toBeLessThan(3);
    expect(a.exploring['place:nha-trang']).toBeGreaterThan(a.exploring['place:ha-noi']!);
  });

  describe('nhảy nơi khi đang tìm chỗ đi', () => {
    const minsAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();
    const searchAt = (placeId: string, m: number) => row({ kind: 'search', targetType: 'place', targetId: placeId, occurredAt: minsAgo(m) });
    const top = (a: ReturnType<typeof live>) => Object.entries(a.exploring).sort((x, y) => y[1] - x[1])[0]![0];

    it('nơi vừa tìm dẫn đầu, nơi tìm vài giờ trước nhạt đi', () => {
      // Nha Trang: 2 lượt tìm 3–4 giờ trước. Hà Nội: 1 lượt vừa tìm.
      const a = live([searchAt('nha-trang', 240), searchAt('nha-trang', 180), searchAt('ha-noi', 5)]);
      expect(top(a)).toBe('place:ha-noi');
      expect(a.exploring['place:nha-trang']).toBeGreaterThan(0);
    });

    it('tìm xen kẽ nhiều nơi trong cùng khoảng thì các nơi gần ngang nhau', () => {
      const a = live([searchAt('nha-trang', 30), searchAt('ha-noi', 20), searchAt('hoi-an', 10)]);
      const w = ['nha-trang', 'ha-noi', 'hoi-an'].map((p) => a.exploring[`place:${p}`]!);
      expect(Math.max(...w) / Math.min(...w)).toBeLessThan(1.5);
    });

    it('vừa thích hoặc bình luận một bài cũng kéo nơi đó lên, nhưng không tự thành đang tìm hiểu', () => {
      const old = [searchAt('nha-trang', 240), searchAt('nha-trang', 180)];
      const reactAt = (postId: string, kind: RawRow['kind'], m: number) => row({ kind, targetType: 'post', targetId: postId, occurredAt: minsAgo(m) });
      expect(top(live([...old, reactAt('dl1', 'reaction', 2)]))).toBe('place:da-lat');
      expect(top(live([...old, reactAt('dl1', 'comment', 2)]))).toBe('place:da-lat');
      // Tương tác lẻ từ 1 ngày trước không còn tác dụng; một mình nó không đổi giai đoạn.
      expect(top(live([...old, reactAt('dl1', 'reaction', 24 * 60)]))).toBe('place:nha-trang');
      expect(live([reactAt('dl1', 'reaction', 2)]).stage).toBe('dreaming');
    });

    it('tìm chủ đề (biển, núi) trong cùng giờ: cả hai đều tính, chủ đề vừa tìm nặng hơn', () => {
      const topicSearch = (exps: string[], m: number) => row({ kind: 'search', detail: { placeIds: [], exps }, occurredAt: minsAgo(m) });
      const a = live([topicSearch(['exp:nui'], 40), topicSearch(['exp:bien'], 2)]);
      expect(a.topics['exp:bien']).toBeGreaterThan(a.topics['exp:nui']!);
      expect(a.topics['exp:nui']).toBeGreaterThan(0);
      expect(a.stage).toBe('dreaming');
    });

    it('ranker: vừa tìm "biển" thì bài biển lên đầu, lý do "vừa tìm bài về biển đảo"', () => {
      const cand = (postId: string, score: number, bins: Record<string, number>) => ({
        postId, authorId: postId, postType: 'video', tags: [], placeId: null, score, source: 'hot' as const, postFeatures: { bins, bookable: 0, hotelId: null },
      });
      const out = tripRankerV1.rank({
        candidates: [cand('hot-food', 0.9, { 'exp:an_uong': 1, 'place:hue': 1 }), cand('beach', 0.2, { 'exp:bien': 1, 'place:quy-nhon': 1 })],
        userFeatures: null,
        now: NOW,
        viewer: { rows: [row({ kind: 'search', detail: { placeIds: [], exps: ['exp:bien'] }, occurredAt: minsAgo(1) })], productPlaces: {} },
      });
      expect(out[0]).toMatchObject({ postId: 'beach', reason: { code: 'matches_interest', text: 'Vì bạn vừa tìm bài về biển đảo' } });
    });

    it('tìm Nha Trang rồi Phú Quốc (nơi nhiều bài biển): bài biển ở nơi chưa tìm (Quy Nhơn) cũng được đẩy lên', () => {
      const cand = (postId: string, score: number, bins: Record<string, number>) => ({
        postId, authorId: postId, postType: 'video', tags: [], placeId: null, score, source: 'hot' as const, postFeatures: { bins, bookable: 0, hotelId: null },
      });
      const many = (place: string, exp: string, n: number) =>
        Array.from({ length: n }, (_, i) => cand(`${place}-${i}`, 0.3, { [`place:${place}`]: 1, [`exp:${exp}`]: 1 }));
      const search = (placeId: string, m: number) => row({ kind: 'search', targetType: 'place', targetId: placeId, occurredAt: minsAgo(m) });
      const out = tripRankerV1.rank({
        candidates: [
          ...many('nha-trang', 'bien', 6), ...many('phu-quoc', 'bien', 6), ...many('ha-noi', 'an_uong', 6), ...many('da-lat', 'nui', 6),
          cand('qn-beach', 0.3, { 'place:quy-nhon': 1, 'exp:bien': 1 }),
          cand('sg-food', 0.3, { 'place:sai-gon': 1, 'exp:an_uong': 1 }),
        ],
        userFeatures: null,
        now: NOW,
        viewer: { rows: [search('nha-trang', 30), search('nha-trang', 100), search('phu-quoc', 5), search('phu-quoc', 70)], productPlaces: {} },
      });
      const at = (id: string) => out.findIndex((r) => r.postId === id);
      expect(at('qn-beach')).toBeLessThan(at('sg-food'));
      expect(out[at('qn-beach')]!.reason.text).toBe('Vì bạn đang tìm hiểu các nơi có biển đảo');
    });

    it('một lượt tìm vẫn chưa đủ để lên kế hoạch (hệ số vừa tìm chỉ đổi thứ tự nơi)', () => {
      expect(live([searchAt('ha-noi', 1)]).stage).toBe('dreaming');
    });
  });

  it('đơn ghi mã loại phòng (<khách sạn>--<phòng>): vẫn biết nơi của chuyến qua khách sạn → đang đi', () => {
    const order = row({ kind: 'order_item', targetType: 'room', targetId: 'P-osm-nha-trang-013--DLX', occurredAt: daysAgo(0.2), detail: { date: '2026-11-12', nights: 3 } });
    expect(live([order], { 'P-osm-nha-trang-013': 'nha-trang' })).toMatchObject({ stage: 'on_trip', trip: { placeId: 'nha-trang', hotelId: 'P-osm-nha-trang-013' } });
  });

  it('hai chuyến trùng thời gian (Đà Lạt 10–13, Nha Trang 12–15): đang đi chuyến vừa bắt đầu, dù đặt trước hay sau', () => {
    const order = (hotel: string, date: string, nights: number, d: number) =>
      row({ kind: 'order_item', targetType: 'room', targetId: `${hotel}--DLX`, occurredAt: daysAgo(d), detail: { date, nights } });
    const places = { 'H-dl': 'da-lat', 'H-nt': 'nha-trang' };
    const dl = order('H-dl', '2026-11-10', 3, 4);
    const nt = order('H-nt', '2026-11-12', 3, 3);
    expect(live([nt, dl], places).trip).toMatchObject({ placeId: 'nha-trang' });
    expect(live([dl, nt], places).trip).toMatchObject({ placeId: 'nha-trang' });
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

  it('bấm đặt trên reels → đang tìm hiểu nơi của bài; xem gần hết 2 reels cùng nơi trong 1 ngày cũng vậy', () => {
    const click = row({ kind: 'booking_click', targetType: 'post', targetId: 'dl1', occurredAt: daysAgo(0.1) });
    expect(live([click])).toMatchObject({ stage: 'planning', exploring: { 'place:da-lat': expect.any(Number) } });
    const view = (postId: string, d: number) =>
      row({ kind: 'view_post', targetType: 'post', targetId: postId, refId: postId, value: 0.9, occurredAt: daysAgo(d), detail: { watchedMs: 27_000, isQualified: true } });
    expect(live([view('nt1', 0.1), view('nt2', 0.3)]).stage).toBe('planning');
    expect(live([view('nt1', 0.1)]).stage).toBe('dreaming');
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

describe('trip_v1', () => {
  const cand = (postId: string, score: number, bins: Record<string, number>, hotelId: string | null = null) => ({
    postId, authorId: 'a', postType: 'video', tags: [], placeId: null, score, source: 'hot' as const,
    postFeatures: { bins, bookable: 0, hotelId },
  });

  it('không có dấu hiệu nào (khách) thì xếp như trending', () => {
    const out = tripRankerV1.rank({ candidates: [cand('low', 0.2, {}), cand('high', 0.9, {})], userFeatures: null, now: NOW, viewer: null });
    expect(out.map((r) => [r.postId, r.reason.code])).toEqual([['high', 'trending'], ['low', 'trending']]);
  });

  it('sắp đi: bài ăn uống ở nơi đã đặt lên đầu; bài khoe khách sạn khác ở đó bị hạ', () => {
    const order = row({ kind: 'order_item', targetType: 'hotel', targetId: 'H1', occurredAt: daysAgo(2), detail: { date: '2026-11-16', nights: 2 } });
    const out = tripRankerV1.rank({
      candidates: [
        cand('food', 0.1, { 'place:nha-trang': 1, 'exp:an_uong': 1 }),
        cand('other-hotel', 0.1, { 'place:nha-trang': 1, 'exp:an_uong': 1 }, 'H2'),
        cand('hot-elsewhere', 0.9, { 'place:da-lat': 1 }),
      ],
      userFeatures: null,
      now: NOW,
      viewer: { rows: [order], productPlaces: { H1: 'nha-trang' } },
    });
    expect(out.map((r) => r.postId)).toEqual(['food', 'other-hotel', 'hot-elsewhere']);
    expect(out[0]!.reason.text).toBe('Cho chuyến Nha Trang 16/11 của bạn');
    expect(out[1]!.score).toBeCloseTo(out[0]!.score / 2, 3);
  });

  it('nơi chính là nơi cụ thể nhất dù jsonb đặt tỉnh cha lên trước', () => {
    const search = (h: number) => row({ kind: 'search', targetType: 'place', targetId: 'nha-trang', occurredAt: daysAgo(h / 24) });
    const out = tripRankerV1.rank({
      candidates: [cand('nt', 0.1, { 'place:khanh-hoa': 0.9, 'place:nha-trang': 0.9 }), cand('cr', 0.1, { 'place:khanh-hoa': 0.8 })],
      userFeatures: null,
      now: NOW,
      viewer: { rows: [search(1), search(3)], productPlaces: {} },
    });
    expect(out.map((r) => [r.postId, r.reason.text, r.diversity?.place])).toEqual([
      ['nt', 'Vì bạn đang tìm hiểu Nha Trang', 'nha-trang'],
      ['cr', 'Gần Nha Trang mà bạn đang tìm hiểu', 'khanh-hoa'],
    ]);
  });

  it('thích 2 bài viết Hà Nội (không phải ứng viên Reels) thì vẫn là đang tìm hiểu Hà Nội', () => {
    const vlog = (postId: string): PostMeta => ({ postId, authorId: 'b', postType: 'vlog', tags: [], placeId: 'ha-noi' });
    const out = tripRankerV1.rank({
      candidates: [cand('hn', 0.1, { 'place:ha-noi': 1 }), cand('nt', 0.9, { 'place:nha-trang': 1 })],
      userFeatures: null,
      now: NOW,
      viewer: { rows: [react('v1', 0.1), react('v2', 0.2, 'comment')], productPlaces: {}, posts: { v1: vlog('v1'), v2: vlog('v2') } },
    });
    expect(out[0]).toMatchObject({ postId: 'hn', reason: { text: 'Vì bạn đang tìm hiểu Hà Nội' } });
  });
});
