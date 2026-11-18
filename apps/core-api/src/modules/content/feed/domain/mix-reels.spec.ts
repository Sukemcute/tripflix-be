import { describe, expect, it } from 'vitest';
import { mixReels } from './mix-reels.js';

const range = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);

describe('mixReels', () => {
  it('cứ 4 ô thì ô thứ 4 là bài hot, giữ thứ tự của từng nguồn', () => {
    const result = mixReels(range('f', 20), range('h', 20), 8);

    expect(result.ids).toEqual(['f1', 'f2', 'f3', 'h1', 'f4', 'f5', 'f6', 'h2']);
    expect(result).toMatchObject({ usedForYou: 6, usedHot: 2 });
  });

  it('trang 20 ô có đúng 5 bài hot ở các ô 4, 8, 12, 16, 20', () => {
    const { ids } = mixReels(range('f', 50), range('h', 50), 20);

    const hotSlots = ids.flatMap((id, i) => (id.startsWith('h') ? [i + 1] : []));
    expect(hotSlots).toEqual([4, 8, 12, 16, 20]);
  });

  it('bài hot đã có trong trang thì bỏ qua và lấy bài hot kế tiếp, vẫn đếm vào usedHot', () => {
    const result = mixReels(['a', 'b', 'c', 'd', 'e', 'f'], ['b', 'x', 'y'], 8);

    expect(result.ids).toEqual(['a', 'b', 'c', 'x', 'd', 'e', 'f', 'y']);
    expect(new Set(result.ids).size).toBe(result.ids.length);
    expect(result).toMatchObject({ usedForYou: 6, usedHot: 3 });
  });

  it('bài "Dành cho bạn" đã lên ở ô hot thì cũng bỏ qua', () => {
    const result = mixReels(['a', 'b', 'c', 'h', 'd'], ['h'], 5);

    expect(result.ids).toEqual(['a', 'b', 'c', 'h', 'd']);
    expect(result).toMatchObject({ usedForYou: 5, usedHot: 1 });
  });

  it('nguồn hot hết bài thì lấp bằng "Dành cho bạn"', () => {
    const result = mixReels(range('f', 10), ['h1'], 8);

    expect(result.ids).toEqual(['f1', 'f2', 'f3', 'h1', 'f4', 'f5', 'f6', 'f7']);
    expect(result).toMatchObject({ usedForYou: 7, usedHot: 1 });
  });

  it('"Dành cho bạn" hết bài thì lấp bằng hot', () => {
    const result = mixReels(['f1'], range('h', 10), 5);

    expect(result.ids).toEqual(['f1', 'h1', 'h2', 'h3', 'h4']);
    expect(result).toMatchObject({ usedForYou: 1, usedHot: 4 });
  });

  it('cả hai nguồn hết thì trả trang ngắn hơn limit', () => {
    expect(mixReels(['f1'], ['h1'], 10)).toEqual({ ids: ['f1', 'h1'], usedForYou: 1, usedHot: 1 });
    expect(mixReels([], [], 10)).toEqual({ ids: [], usedForYou: 0, usedHot: 0 });
  });

  it('dùng usedForYou, usedHot làm vị trí bắt đầu thì trang sau nối tiếp, không lặp không sót', () => {
    const forYou = range('f', 30);
    const hot = range('h', 10);
    const first = mixReels(forYou, hot, 8);
    const second = mixReels(forYou.slice(first.usedForYou), hot.slice(first.usedHot), 8);

    expect(second.ids).toEqual(['f7', 'f8', 'f9', 'h3', 'f10', 'f11', 'f12', 'h4']);
    expect(first.ids.filter((id) => second.ids.includes(id))).toEqual([]);
  });

  it('đổi được tỉ lệ bằng every', () => {
    expect(mixReels(range('f', 5), range('h', 5), 4, 2).ids).toEqual(['f1', 'h1', 'f2', 'h2']);
  });

  it('limit 0 trả trang rỗng; limit hoặc every không hợp lệ thì báo lỗi', () => {
    expect(mixReels(['f1'], ['h1'], 0)).toEqual({ ids: [], usedForYou: 0, usedHot: 0 });
    expect(() => mixReels([], [], -1)).toThrow(RangeError);
    expect(() => mixReels([], [], 1.5)).toThrow(RangeError);
    expect(() => mixReels([], [], 4, 1)).toThrow(RangeError);
  });
});
