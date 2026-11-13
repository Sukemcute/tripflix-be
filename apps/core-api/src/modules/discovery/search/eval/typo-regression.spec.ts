// Chạy trong CI: lỗi gõ sinh ngẫu nhiên (seed cố định) trên 220 khách sạn seed, mô phỏng lúc dữ liệu còn ít (cold start).
// Ngưỡng chốt sau khi đo (13/11/2026) trên đúng bộ câu này: 71% (bench đầy đủ: bản trước khi sửa ~60% với tên nơi bỏ 1-2 ký tự).
import { searchExplore } from '../domain/explore/rank.js';
import type { ExploreObject } from '../domain/explore/types.js';
import { buildCases, dayPairBench, runBench, seedHotels, seedPosts, sourceOf } from './typo-bench.js';

const objs = seedHotels(220);
const source = sourceOf(objs);
const stays = async (q: string) => {
  const r = await searchExplore(source, q);
  return { r, stay: r.sections.find((s) => s.kind === 'stay')! };
};

describe('lỗi gõ khi dữ liệu còn ít', () => {
  it.each(['nha trag', 'nha tang', 'nhatrag', 'nah trang', 'nh trang'])('"%s" ra khách sạn Nha Trang', async (q) => {
    const { r, stay } = await stays(q);
    expect(r.understood.place).toBe('Nha Trang');
    expect(stay.total).toBeGreaterThan(0);
    expect(stay.items.every((i) => i.obj.place === 'Nha Trang')).toBe(true);
  });

  it('tên nơi gõ thiếu 1-2 ký tự: recall >= 68%, tên gõ đúng không bị sửa', async () => {
    const rows = await runBench(source, buildCases(objs, { sources: ['place'], ops: ['drop1', 'drop2'], perName: 3 }));
    const row = (g: string) => rows.find((x) => x.group === g)!;
    expect(row('*/typo').recallMain).toBeGreaterThanOrEqual(68);
    expect(row('*/clean')).toMatchObject({ recallMain: 100, fixedRate: 0 });
  }, 60_000);

  it('vượt ngân sách chỉ có trong kết quả thay thế, không bao giờ ở kết quả chính', async () => {
    const { r, stay } = await stays('khách sạn đà lạt dưới 100k');
    expect(stay.total).toBe(0);
    expect(r.fallback?.relaxed).toEqual(['budget']);
    expect(r.fallback!.items.length).toBeGreaterThan(0);
    expect(r.fallback!.items.every((i) => i.relaxed?.includes('budget') && i.reason.includes('vượt ngân sách'))).toBe(true);
    expect(r.suggest.map((i) => i.obj.id)).toEqual(r.fallback!.items.map((i) => i.obj.id)); // trường cũ vẫn có cho FE cũ
  });

  it('câu ngoài phạm vi, vô nghĩa: không có kết quả chính lẫn thay thế', async () => {
    for (const q of ['cách nấu phở bò', 'zzzz']) {
      const { r } = await stays(q);
      expect([q, r.sections.some((s) => s.total), r.fallback]).toEqual([q, false, null]);
    }
  });
});

describe('số ngày: thứ tự chữ có nghĩa', () => {
  const at = (x: Pick<ExploreObject, 'id' | 'kind' | 'title'> & Partial<ExploreObject>): ExploreObject => ({ src: 'OSM', text: '', n: 0, place: 'Nha Trang', lat: 12.24, lon: 109.19, ...x });
  const days = sourceOf([
    at({ id: 'plan3', kind: 'plan', title: 'Nha Trang 3 ngày 2 đêm chill', days: 3 }),
    at({ id: 'plan4', kind: 'plan', title: 'Nha Trang 4N3Đ biển đảo', days: 4 }),
    at({ id: 'trip3', kind: 'video', title: 'Du lịch Nha Trang 3 ngày tự túc', days: 3 }),
    at({ id: 'day3', kind: 'video', title: 'Vlog Nha Trang ngày 3: lặn ngắm san hô Hòn Mun' }),
    at({ id: 'day1', kind: 'video', title: 'Vlog Nha Trang ngày 1: tắm biển Trần Phú' }),
  ]);
  const top = async (q: string, kind: string) => {
    const r = await searchExplore(days, q);
    return [r.understood.days, r.sections.find((s) => s.kind === kind)!.items.map((i) => i.obj.id).slice(0, 2)];
  };

  it('"3 ngày" là chuyến 3 ngày: vlog "ngày 3" không được cộng vì chữ', async () => {
    expect(await top('3 ngày ở nha trang', 'video')).toEqual([3, ['trip3', expect.any(String)]]);
    const videos = (await searchExplore(days, '3 ngày ở nha trang')).sections.find((s) => s.kind === 'video')!.items;
    const score = (id: string) => videos.find((i) => i.obj.id === id)!.score;
    expect(score('day3')).toBe(score('day1')); // 'ngày 3' trong tên không khớp cụm '3 ngày'
    expect(await top('3 ngày ở nha trang', 'plan')).toEqual([3, ['plan3', 'plan4']]);
  });

  it('"ngày 3" ưu tiên ngày thứ 3, rồi tới chuyến 3 ngày', async () => {
    expect(await top('ngày 3 ở nha trang', 'video')).toEqual([3, ['day3', 'trip3']]);
    expect(await top('ngay 3 o nha trang', 'video')).toEqual([3, ['day3', 'trip3']]);
  });

  it('dữ liệu seed: câu "N ngày" ra đúng số ngày ở mục đầu >= 80%', async () => {
    const posts = [...objs, ...seedPosts()];
    expect((await dayPairBench(sourceOf(posts), posts)).top1Days).toBeGreaterThanOrEqual(80);
  }, 60_000);
});
