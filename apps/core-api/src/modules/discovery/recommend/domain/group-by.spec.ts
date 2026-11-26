import { groupBy } from './group-by.js';

describe('groupBy', () => {
  it('gom theo khoá, giữ thứ tự xuất hiện trong từng nhóm và thứ tự nhóm', () => {
    const rows = [
      { actorId: 'b', n: 1 },
      { actorId: 'a', n: 2 },
      { actorId: 'b', n: 3 },
    ];
    const groups = groupBy(rows, (r) => r.actorId);
    expect([...groups.keys()]).toEqual(['b', 'a']);
    expect(groups.get('b')!.map((r) => r.n)).toEqual([1, 3]);
    expect(groups.get('a')!.map((r) => r.n)).toEqual([2]);
  });

  it('gọi hàm khoá đúng một lần mỗi phần tử', () => {
    const keyOf = vi.fn((x: number) => x % 2);
    groupBy([1, 2, 3, 4], keyOf);
    expect(keyOf).toHaveBeenCalledTimes(4);
  });

  it('200.000 dòng của vài người: tuyến tính, không chặn event loop hàng giây', () => {
    const rows = Array.from({ length: 200_000 }, (_, i) => ({ actorId: `u${i % 3}` }));
    const startedAt = performance.now();
    const groups = groupBy(rows, (r) => r.actorId);
    // Bản chép mảng mỗi phần tử mất ~2 s ở 50.000 dòng; bản push ~5 ms.
    expect(performance.now() - startedAt).toBeLessThan(500);
    expect(groups.get('u0')).toHaveLength(66_667);
  });
});
