// Chép các tự kiểm của prototype Python (engine.py, ngrams.py): bản TS phải cho cùng kết quả.
import { buildIndex } from './build.js';
import { MemoryExploreSource } from './memory-source.js';
import { budgetOf, parse, typoFix, understand, view } from './query.js';
import { searchExplore, VERTICALS } from './rank.js';
import { Stats } from './stats.js';
import { abbrs, accWords, destOf, fold, norm, objTier, tierOf, topicsOf } from './text.js';
import type { ExploreObject } from './types.js';

const src = (objs: ExploreObject[]) => new MemoryExploreSource(buildIndex(objs));
const o = (x: Partial<ExploreObject> & Pick<ExploreObject, 'id' | 'kind' | 'title'>): ExploreObject => ({ src: 'OSM', text: '', n: 0, ...x });
const ids = async (objs: ExploreObject[], q: string, perSection?: number) =>
  (await searchExplore(src(objs), q, { perSection })).sections[0]!.items.map((i) => i.obj.id);

describe('hiểu câu', () => {
  it('nơi, ý muốn, chủ đề, số ngày, ngân sách', () => {
    let u = parse('an gi o hoi an 😋');
    expect([u.place, u.intents.includes('food'), u.concepts.includes('ngon')]).toEqual(['Hội An', true, true]);
    u = parse('cf chill dalat');
    expect([u.place, u.intents, u.concepts.includes('chill')]).toEqual(['Đà Lạt', ['cafe'], true]);
    u = parse('ks gần biển nt');
    expect([u.place, u.intents.includes('stay'), u.concepts.includes('bien')]).toEqual(['Nha Trang', true, true]);
    u = parse('phú quốc 3 ngày 2 đêm');
    expect([u.days, u.terms]).toEqual([3, []]);
    u = parse('lịch trình 3n2đ sapa');
    expect([u.place, u.intents.includes('plan'), u.days]).toEqual(['Sa Pa', true, 3]);
    expect(parse('homestay đà lạt').subtypes).toEqual([['homestay', 0.8]]);
    u = parse('đà lạt 3n2đ dưới 3 triệu');
    expect([u.budget, u.days, u.intents.includes('plan')]).toEqual([3_000_000, 3, true]);
    expect([budgetOf('duoi 3tr')[0], budgetOf('1tr5')[0], budgetOf('500k')[0]]).toEqual([3_000_000, 1_500_000, 500_000]);
    expect(parse('hải sản giá rẻ').soft).toContain('gia re');
    expect(parse('hải sản giá rẻ').soft).not.toContain('hai san');
    expect(parse('quán ngon').quality).toBe(true);
  });

  it('chuẩn hoá chữ', () => {
    expect(norm('Ngonnn qá ko')).toBe('ngon qua khong');
    expect(fold('Mỳ Quảng')).toBe(fold('mì quảng'));
    expect(accWords('Mỳ Quảng')).toEqual(accWords('mì quảng'));
    expect(fold('quí')).toBe(fold('quý'));
    expect(fold('my')).toBe('my');
    expect(norm('my quang')).toBe(norm('mì quảng'));
    expect(norm('hủ tíu')).toBe(norm('hu tieu'));
    expect(accWords('Hoà Bình')).toEqual(accWords('Hòa Bình'));
    expect(fold('Ðồng Khởi')).toBe('dong khoi');
    expect(accWords('Ðồng')).toEqual(accWords('Đồng'));
    expect([...topicsOf('Lịch trình Hà Giang 3N2D')]).toEqual(['plan']);
    expect(destOf('#dalat #reviewdalat')).toBe('Đà Lạt');
    expect(abbrs('Long Xuyên')).toEqual(['#lx']);
    expect(tierOf('Areca Resort & Hotel')).toEqual(['cao cap', 3]);
    expect(tierOf('Phở Thìn')).toBeNull();
    expect(objTier({ title: 'Nhà Bống Homestay', subtype: 'hotel' })).toEqual(['binh dan', 1]);
  });

  it('nhánh chỗ ở không hiểu "ngon"', () => {
    const v = view(parse('homestay ngon view đẹp'), VERTICALS.find((x) => x.name === 'stays')!.mods);
    expect([...v.terms, ...v.seq]).not.toContain('ngon');
    expect(v.terms).toContain('view dep');
    expect(v.quality).toBe(false);
  });

  it('độ dính cụm: com tam | long xuyen', async () => {
    const texts = ['com tam long xuyen', 'com tam sai gon', 'com tam suon', 'cafe long xuyen', 'bun bo long xuyen', 'com ga', 'tam biet',
      'long bien', 'com tam ba ghien', 'pho long', 'long xuyen an giang', 'cho long xuyen', 'com tam cali', 'long thanh', 'long hai',
      'banh xeo long xuyen'];
    const st = new Stats(src([0, 1, 2].flatMap((r) => texts.map((t, i) => o({ id: `${r}-${i}`, kind: 'food', title: t }))) as ExploreObject[]));
    await st.loadSeq('com tam long xuyen'.split(' '));
    expect(st.npmi('com', 'tam')).toBeGreaterThan(st.npmi('tam', 'long'));
    expect(st.npmi('long', 'xuyen')).toBeGreaterThan(0.3);
    expect(st.segment('com tam long xuyen'.split(' '))).toEqual([['com', 'tam'], ['long', 'xuyen']]);
  });
});

describe('tìm', () => {
  const cafes = [
    o({ id: 'c1', kind: 'cafe', title: 'Cà phê Trung Nguyên', place: 'Hà Nội' }),
    o({ id: 'c2', kind: 'cafe', title: 'Cà Phê Giảng - Cà Phê Trứng', place: 'Hà Nội' }),
    o({ id: 'c3', kind: 'cafe', title: 'Ca phe trung Hoa', place: 'Hà Nội' }),
  ];
  const plans = [
    o({ id: 'p1', kind: 'plan', src: 'x', title: 'Đà Lạt 3N2Đ', text: 'lich trinh', place: 'Đà Lạt', cost: 2_500_000, days: 3 }),
    o({ id: 'p2', kind: 'plan', src: 'x', title: 'Đà Lạt 3N2Đ sang', text: 'lich trinh', place: 'Đà Lạt', cost: 6_000_000, days: 3 }),
  ];

  it('tên không dấu không bắt đúng dấu; có kết quả trước, rỗng sau', async () => {
    const ba = src([o({ id: 'b', kind: 'see', src: 'WV', title: 'Ba Na Hills', text: 'Ba Na Hills, the hills are 25 km from Lăng Cô and Da Nang' })]);
    expect((await searchExplore(ba, 'bà nà')).sections[0]!.total).toBe(1);
    const sec = (await searchExplore(src([o({ id: 'v', kind: 'stay', title: 'Vinpearl Resort' })]), 'vinpearl')).sections;
    expect([sec[0]!.kind, sec.at(-1)!.total]).toEqual(['stay', 0]);
  });

  it('chỉ hiện kết quả khớp; ngân sách là lọc cứng', async () => {
    const food = [
      o({ id: '1', kind: 'food', title: 'Bún chả Hương Liên', text: 'bun cha ngon', place: 'Hà Nội' }),
      o({ id: '2', kind: 'food', title: 'Phở Thìn', text: 'pho bo', place: 'Hà Nội' }),
      cafes[1]!,
    ];
    const r = await searchExplore(src(food), 'bún chả hà nội');
    expect(r.sections.find((s) => s.kind === 'food')!.items.map((i) => i.obj.id)).toEqual(['1']);
    expect(await ids(plans, 'lịch trình đà lạt 3n2đ dưới 3tr')).toEqual(['p1']);
  });

  it('luật dấu và mọi cách viết cafe', async () => {
    expect(await ids(cafes, 'cà phê trứng')).toEqual(['c2', 'c3']);
    expect(new Set(await ids(cafes, 'ca phe trung'))).toEqual(new Set(['c1', 'c2', 'c3']));
    for (const q of ['caffe trứng', 'coffee trứng', 'cafe trứng', 'cafffee trứng', 'cofeeee trứng']) {
      expect(await ids(cafes, q)).toEqual(['c2', 'c3']);
    }
  });

  it('từ bối cảnh lọc theo; không gì khớp thì có gợi ý khác', async () => {
    const ha = [
      o({ id: 'h1', kind: 'see', title: 'Phố cổ Hội An', place: 'Hội An' }),
      o({ id: 'h2', kind: 'see', title: 'Biển An Bàng', text: 'đẹp nhất mùa hè', place: 'Hội An' }),
      o({ id: 'h3', kind: 'see', title: 'Đại Nội', text: 'đông dịp lễ', place: 'Huế' }),
    ];
    let r = await searchExplore(src(ha), 'đi chơi hội an mùa hè');
    expect([r.sections[0]!.kind, r.sections[0]!.items.map((i) => i.obj.id)]).toEqual(['see', ['h2']]);
    r = await searchExplore(src(ha), 'hội an dịp lễ');
    expect(r.sections.some((s) => s.total)).toBe(false);
    expect(new Set(r.suggest.map((i) => i.obj.id))).toEqual(new Set(['h1', 'h2']));
    expect(r.dropped).toEqual(['dịp', 'lễ']);
  });

  it('tên đường trong địa chỉ là tên riêng', async () => {
    const objs = [
      o({ id: 's1', kind: 'food', title: 'Quán Ba Ghiền', addr: '84 Đường Ðặng Văn Ngữ' }),
      o({ id: 's2', kind: 'cafe', title: 'Cafe Ngữ', addr: '12 Đặng Văn Ngữ, Phú Nhuận' }),
      o({ id: 's3', kind: 'food', title: 'Đặng Quán', text: 'văn hay ngữ', addr: '1 Lê Lợi' }),
    ];
    const st = new Stats(src(objs));
    await st.loadSeq(['dang', 'van', 'ngu', 'le', 'loi']);
    expect([st.isName('dang van ngu'), st.isName('le loi')]).toEqual([true, false]);
    const r = await searchExplore(src(objs), 'đặng văn ngữ');
    expect(new Set(r.sections.flatMap((s) => s.items.map((i) => i.obj.id)))).toEqual(new Set(['s1', 's2']));
    const st2 = new Stats(src(objs.filter((x) => x.id !== 's2')));
    await st2.loadSeq(['dang', 'van', 'ngu']);
    expect(st2.isName('dang van ngu')).toBe(false);
    const [u] = await understand('cafe hồ tây', new Stats(src(objs)));
    expect([u.names, u.place]).toEqual([['ho tay'], 'Hà Nội']);
  });

  it('chuỗi cửa hàng khác tên món', async () => {
    const pizza = [['Nguyễn Trãi', 'Sài Gòn'], ['Lê Lợi', 'Sài Gòn'], ['Trần Phú', 'Đà Nẵng']].map(([s, pl], i) =>
      o({ id: `p${i}`, kind: 'food', title: `Pizza Hut ${s}`, addr: `${i} ${s}`, place: pl }),
    );
    const banh = ['Bánh mì', 'Bánh mì', 'Bánh mì', 'Bánh mì Phượng', 'Bánh mì Huỳnh Hoa', 'Tiệm bánh mì 37', 'Bánh mì 25'].map((t, i) =>
      o({ id: `b${i}`, kind: 'food', title: t, place: 'Hà Nội' }),
    );
    const st = new Stats(src([...pizza, ...banh]));
    await st.loadSeq(['pizza', 'hut', 'banh', 'mi']);
    expect([st.isChain('pizza hut'), st.isChain('banh mi')]).toEqual([true, false]);
    const st2 = new Stats(src([...pizza.slice(0, 2), ...banh]));
    await st2.loadSeq(['pizza', 'hut']);
    expect(st2.isChain('pizza hut')).toBe(false); // còn 1 nơi -> chưa là chuỗi
  });

  it('vị trí người dùng chỉ dùng khi câu không nói nơi', async () => {
    const s = src([
      o({ id: 'far', kind: 'cafe', title: 'Cafe Xa', lat: 21.03, lon: 105.85, place: 'Hà Nội', rating: 4.9, n: 500 }),
      o({ id: 'nr', kind: 'cafe', title: 'Cafe Gần', lat: 10.777, lon: 106.701, place: 'Sài Gòn', rating: 4.0, n: 5 }),
    ]);
    const first = async (q: string, loc?: { lat: number; lon: number }) => (await searchExplore(s, q, { loc })).sections[0]!.items[0]!.obj.id;
    expect(await first('cafe')).toBe('far');
    expect(await first('cafe', { lat: 10.7769, lon: 106.7009 })).toBe('nr');
    const r = await searchExplore(s, 'cafe hà nội', { loc: { lat: 10.7769, lon: 106.7009 } });
    expect([r.understood.place, r.nearUser, r.sections[0]!.items[0]!.obj.id]).toEqual(['Hà Nội', false, 'far']);
  });

  it('viết tắt địa danh và sửa lỗi gõ', async () => {
    const ct = [
      o({ id: 'a', kind: 'food', title: 'Cơm Tấm Long Xuyên', area: 'An Giang' }),
      o({ id: 'b', kind: 'food', title: 'Cơm tấm Cali', area: 'Quan 1' }),
      o({ id: 'c', kind: 'food', title: 'Bún cá', area: 'Long Xuyen, An Giang' }),
    ];
    expect((await ids(ct, 'cơm tấm lx'))[0]).toBe('a');
    expect((await ids(ct, 'cơm tấm long xuyên'))[0]).toBe('a');
    expect(new Set(await ids(ct, 'lx'))).toEqual(new Set(['a', 'c']));
    const big = [...cafes, ...Array.from({ length: 20 }, (_, i) => o({ id: `x${i}`, kind: 'food', title: `Bánh trứng ${i}`, place: 'Hà Nội' }))];
    expect(Object.fromEntries(await typoFix(['trug', 'trung'], new Stats(src(big))))).toEqual({ trug: 'trung' });
    const same = await searchExplore(src(big), 'cafe trung');
    const fixed = await searchExplore(src(big), 'cafe trug');
    expect(fixed.sections[0]!.items.map((i) => i.obj.id)).toEqual(same.sections[0]!.items.map((i) => i.obj.id));
    expect([fixed.understood.fixed, same.understood.fixed]).toEqual([{ trug: 'trung' }, {}]);
  });

  it('cùng phủ đủ thì chất lượng quyết định; chỉ khớp từ bổ nghĩa thì loại', async () => {
    const eggs = [
      o({ id: 'e1', kind: 'cafe', title: 'Cà Phê Trứng Nàng K', text: 'trung trung ngon', n: 4, rating: 2.75 }),
      o({ id: 'e2', kind: 'cafe', title: 'Cafe Trứng Bóong Xồm', n: 15, rating: 4.13 }),
      o({ id: 'e3', kind: 'cafe', title: 'Starbucks', text: 'ngon ngon', n: 40, rating: 4.83 }),
    ];
    expect(await ids(eggs, 'cf trứng')).toEqual(['e2', 'e1']);
    expect(await ids(eggs, 'cà phê trứng')).toEqual(['e2', 'e1']);
    expect(await ids(eggs, 'cà phê trứng ngon')).not.toContain('e3');
    expect(new Set(await ids(eggs, 'cafe ngon'))).toEqual(new Set(['e1', 'e3']));
    const sea = [
      o({ id: 's1', kind: 'food', title: 'Ốc Diễm', text: 'oc ngon re', place: 'Vũng Tàu' }),
      o({ id: 's2', kind: 'food', title: 'Com Tam', text: 'gia re sinh vien, se ghe lai', place: 'Vũng Tàu' }),
    ];
    expect(await ids(sea, 'hải sản vũng tàu giá rẻ')).toEqual(['s1']); // chủ đề 'hải sản' bắt buộc
  });

  it('chỗ ở cùng tầm và ngân sách', async () => {
    const hs = [
      o({ id: 'h1', kind: 'stay', title: 'Sakura Hotel', text: 'cheap' }),
      o({ id: 'h2', kind: 'stay', title: 'Nhà Bống Homestay' }),
      o({ id: 'h3', kind: 'stay', title: 'Mây Hostel' }),
      o({ id: 'h4', kind: 'stay', title: 'Vinpearl Resort' }),
      o({ id: 'h5', kind: 'stay', title: 'Dorm Backpackers', priceNight: 900_000 }),
    ];
    const got = await ids(hs, 'homestay');
    expect(got[0]).toBe('h2');
    expect(got).toContain('h3');
    expect(got).not.toContain('h4');
    expect((await ids(hs, 'homestay giá rẻ'))[0]).toBe('h2');
    expect(await ids(hs, 'homestay dưới 500k')).not.toContain('h5');
  });

  it('cụm dính: mì quảng không kéo bánh mì', async () => {
    const mq = [
      o({ id: 'm1', kind: 'food', title: 'Mì Quảng Bà Mua' }),
      o({ id: 'm2', kind: 'food', title: 'Bánh mì Phượng' }),
      ...Array.from({ length: 5 }, (_, i) => o({ id: `q${i}`, kind: 'food', title: `Mì Quảng ${i}` })),
      ...Array.from({ length: 5 }, (_, i) => o({ id: `b${i}`, kind: 'food', title: `Bánh mì ${i}` })),
    ];
    expect(await ids(mq, 'mì quảng', 20)).not.toContain('m2');
  });

  it('gần nơi trong câu xếp sau; video lộ trình hiện ở cả 2 vùng', async () => {
    const near = [
      o({ id: 'n1', kind: 'food', title: 'Bún Hội', place: 'Hội An', lat: 15.88, lon: 108.33 }),
      o({ id: 'n2', kind: 'food', title: 'Bún Hàn', place: 'Đà Nẵng', lat: 16.05, lon: 108.2 }),
      o({ id: 'n3', kind: 'food', title: 'Bún Huế', place: 'Huế', lat: 16.46, lon: 107.6 }),
    ];
    const items = (await searchExplore(src(near), 'bún hội an')).sections[0]!.items;
    expect(items.map((i) => i.obj.id)).toEqual(['n1', 'n2']);
    expect(items[1]!.reason).toContain('Gần Hội An');
    const vt = [
      o({ id: 't1', kind: 'video', src: 'TikTok', title: 'Lịch trình Đà Lạt 3N2Đ', text: 'lich trinh da lat', topics: ['plan'], place: 'Đà Lạt', views: 50_000 }),
      ...plans,
    ];
    const secs = Object.fromEntries((await searchExplore(src(vt), 'lịch trình đà lạt')).sections.map((s) => [s.kind, s.items.map((i) => i.obj.id)]));
    expect(secs.video).toContain('t1');
    expect(secs.plan).toEqual(expect.arrayContaining(['t1', 'p1']));
  });
});
