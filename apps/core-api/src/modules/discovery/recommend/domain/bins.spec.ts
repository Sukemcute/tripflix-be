import { PLACES } from '../../search/domain/places.js';
import { assignBins, captionExpOf, EXP_DESCRIPTION_TEXTS, expsOfQuery, queryExpOf } from './bins.js';
import { hotV2 } from './builders/hot.js';
import { postProfileV1 } from './builders/post-profile.js';
import type { PostBuildItem } from './contracts.js';
import { EXP, EXP_DESCRIPTIONS, PHRASE_BINS, TAG_BINS, TAG_PLACES } from './topics.js';

type Content = NonNullable<Parameters<typeof assignBins>[0]['content']>;
const post = ({ tags = [], placeId = null, ...content }: { tags?: string[]; placeId?: string | null } & Content) =>
  assignBins({ tags, placeId, content });

describe('topics', () => {
  const binCodes = new Set([
    ...EXP.map((e) => `exp:${e}`),
    ...['binh_dan', 'trung', 'cao_cap'].map((c) => `cost:${c}`),
    ...['mot_minh', 'cap_doi', 'nhom_ban', 'gia_dinh'].map((w) => `with:${w}`),
    ...['ngan', 'vua', 'dai'].map((l) => `len:${l}`),
    ...['xuan', 'he', 'thu', 'dong', 'tet'].map((s) => `season:${s}`),
  ]);

  it('mọi ngăn trong bảng map thuộc bộ từ vựng, mọi nơi có trong PLACES', () => {
    for (const bins of Object.values(TAG_BINS)) for (const b of bins) expect(binCodes).toContain(b);
    for (const b of Object.keys(PHRASE_BINS)) expect(binCodes).toContain(b);
    const placeIds = new Set(PLACES.map((p) => p.id));
    for (const id of Object.values(TAG_PLACES)) expect(placeIds).toContain(id);
  });
});

describe('assignBins', () => {
  it('nơi: bài có khách sạn tin 1, kèm tỉnh cha cùng độ tin', () => {
    expect(post({ placeId: 'nha-trang', trip: { hotelId: 'H1', daysCount: null, estimatedCostPerPerson: null, items: [] } })).toMatchObject({
      'place:nha-trang': 1,
      'place:khanh-hoa': 1,
    });
    expect(post({ placeId: 'nha-trang' })['place:nha-trang']).toBe(0.9);
  });

  it('nơi: chưa có placeId thì lấy tag nơi (0,8), rồi tới tên nơi trong nội dung (0,6)', () => {
    expect(post({ tags: ['fyp', 'SaPa'] })).toEqual({ 'place:lao-cai': 0.8 });
    expect(post({ body: 'Ba ngày lang thang Đà Lạt' })).toMatchObject({ 'place:da-lat': 0.6, 'place:lam-dong': 0.6 });
    expect(post({ placeId: 'hue', tags: ['sapa'] })['place:lao-cai']).toBeUndefined();
  });

  it('một nguồn mạnh là đủ vào ngăn; nội dung một mình thì không; hai nguồn cộng lại', () => {
    expect(post({ tags: ['streetfood', 'anvat'] })).toEqual({ 'exp:an_uong': 0.5 });
    expect(post({ title: 'Cà phê sáng ở Sa Pa' })['exp:cafe']).toBe(0.5);
    expect(post({ body: 'ghé quán cà phê' })['exp:cafe']).toBeUndefined();
    expect(post({ tags: ['cafe'], body: 'ghé quán cà phê' })['exp:cafe']).toBe(0.8);
    expect(post({ tags: ['cafe'], title: 'Cà phê sáng', body: 'cà phê ngon' })['exp:cafe']).toBe(1);
  });

  it('tag mơ hồ và tag nền tảng không vào ngăn nào', () => {
    expect(post({ tags: ['fyp', 'xuhuong', 'chill', 'khachsan', 'review'] })).toEqual({});
  });

  it('chữ trùng hashtag trong tiêu đề seed ("vanhoa cả ngày") cũng tính là tiêu đề', () => {
    expect(post({ title: 'Ngày 3 ở Ninh Bình: vanhoa cả ngày' })['exp:van_hoa']).toBe(0.5);
  });

  it('không bắt nhầm chữ trùng sau khi bỏ dấu: chưa ≠ chùa, Biên Hoà ≠ biển', () => {
    const bins = post({ title: 'Chưa đi Biên Hoà bao giờ' });
    expect(bins['exp:van_hoa']).toBeUndefined();
    expect(bins['exp:bien']).toBeUndefined();
  });

  it('resort vào cả nghỉ dưỡng lẫn cao cấp', () => {
    expect(post({ tags: ['resort'] })).toEqual({ 'exp:nghi_duong': 0.5, 'cost:cao_cap': 0.5 });
  });

  it('lộ trình: loại điểm, chi phí/người theo ngưỡng, số ngày', () => {
    const trip = (cost: number, days: number) => ({
      hotelId: null,
      daysCount: days,
      estimatedCostPerPerson: cost,
      items: [{ location: null, category: 'food' }, { location: null, category: 'food' }],
    });
    expect(post({ trip: trip(1_500_000, 2) })).toEqual({ 'exp:an_uong': 0.5, 'cost:binh_dan': 0.5, 'len:ngan': 1 });
    expect(post({ trip: trip(2_500_000, 3) })).toMatchObject({ 'cost:trung': 0.5, 'len:vua': 1 });
    expect(post({ trip: trip(5_000_000, 6) })).toMatchObject({ 'cost:cao_cap': 0.5, 'len:dai': 1 });
  });

  it('mùa và đi với ai từ chữ trong bài', () => {
    expect(post({ title: 'Mù Cang Chải mùa lúa chín tháng 9 cùng người yêu' })).toMatchObject({ 'season:thu': 0.5, 'with:cap_doi': 0.5 });
  });
});

describe('post_profile@v1', () => {
  const now = new Date('2026-11-13T00:00:00Z');
  const item = (postId: string, extra: Partial<PostBuildItem> = {}): PostBuildItem => ({
    postId,
    authorId: 'a',
    postType: 'video',
    tags: ['streetfood'],
    placeId: 'nha-trang',
    publishedAt: '2026-11-12T00:00:00Z',
    completeness: 0.5,
    hasPlan: true,
    interactions: { reaction: postId === 'p1' ? 5 : 1 },
    interactions24h: {},
    ...extra,
  });

  it('giữ nguyên điểm và features của hot@v2, thêm ngăn và bookable', async () => {
    const items = [item('p1', { content: { isVerified: true, trip: { hotelId: 'H1', daysCount: 2, estimatedCostPerPerson: null, items: [] } } }), item('p2')];
    const [hot, profile] = await Promise.all([hotV2.build(items, now), postProfileV1.build(items, now)]);
    expect(profile.map((o) => o.score)).toEqual(hot.map((o) => o.score));
    const p1 = profile.find((o) => o.postId === 'p1')!.features;
    expect(p1).toMatchObject(hot.find((o) => o.postId === 'p1')!.features);
    expect(p1).toMatchObject({ bins: { 'place:nha-trang': 1, 'place:khanh-hoa': 1, 'exp:an_uong': 0.5, 'len:ngan': 1 }, bookable: 1 });
    expect(profile.find((o) => o.postId === 'p2')!.features).toMatchObject({ bookable: 0.4 });
    for (const o of profile) expect(postProfileV1.featuresSchema.safeParse(o.features).success).toBe(true);
  });
});

describe('ngăn từ caption (vector nhúng)', () => {
  // Mỗi ngăn exp một trục; caption = vector đơn vị trộn giữa hai trục.
  const descriptions = EXP.map((_, i) => EXP.map((__, j) => (i === j ? 1 : 0)));
  const mix = (a: number, b: number, wa: number) => {
    const v = EXP.map((_, j) => (j === a ? wa : j === b ? 1 - wa : 0));
    const n = Math.hypot(...v);
    return v.map((x) => x / n);
  };
  const bien = EXP.indexOf('bien');
  const nui = EXP.indexOf('nui');

  it('captionExpOf: gần một ngăn rõ ràng thì ra ngăn đó; hai ngăn sát nhau (biên < 0,0075) thì null', () => {
    expect(captionExpOf(mix(bien, nui, 0.9), descriptions)).toBe('exp:bien');
    expect(captionExpOf(mix(bien, nui, 0.502), descriptions)).toBeNull();
  });

  it('mô tả ngăn theo đúng thứ tự EXP', () => {
    expect(EXP_DESCRIPTION_TEXTS).toEqual(EXP.map((e) => EXP_DESCRIPTIONS[e]));
  });

  it('ngăn từ caption vào với độ tin 0,5 (đủ ngưỡng một mình); null hay thiếu thì không góp', () => {
    expect(post({ body: 'Chill cả buổi chiều nghe sóng', captionExp: 'exp:bien' })).toEqual({ 'exp:bien': 0.5 });
    expect(post({ body: 'Đi chơi cuối tuần', captionExp: null })).toEqual({});
    expect(post({ body: 'Đi chơi cuối tuần' })).toEqual({});
  });

  it('cộng với nguồn khác như mọi nguồn: hashtag biển + caption biển = 1', () => {
    expect(post({ tags: ['dulichbien'], body: 'Một ngày ở đảo', captionExp: 'exp:bien' })).toEqual({ 'exp:bien': 1 });
  });
});

describe('chủ đề của câu tìm', () => {
  it('từ khoá: một chữ "biển", "núi" cũng tính; câu có cụm từ rõ cũng tính; câu không nhắc chủ đề thì rỗng', () => {
    expect(expsOfQuery('biển')).toEqual(['exp:bien']);
    expect(expsOfQuery('Núi')).toEqual(['exp:nui']);
    expect(expsOfQuery('quán cà phê view đẹp đà lạt')).toEqual(expect.arrayContaining(['exp:cafe']));
    expect(expsOfQuery('đi đâu cho đỡ buồn')).toEqual([]);
  });

  it('nhúng: nhận ngăn gần nhất chỉ khi hơn ngăn thứ hai đủ biên', () => {
    const descriptions = EXP_DESCRIPTION_TEXTS.map((_, i) => Array.from({ length: 9 }, (_, j) => (i === j ? 1 : 0)));
    const near = (i: number, second: number, gap: number) => Array.from({ length: 9 }, (_, j) => (j === i ? 0.5 + gap : j === second ? 0.5 : 0));
    expect(queryExpOf(near(4, 0, 0.05), descriptions)).toBe('exp:bien');
    expect(queryExpOf(near(4, 0, 0.001), descriptions)).toBeNull();
  });
});
