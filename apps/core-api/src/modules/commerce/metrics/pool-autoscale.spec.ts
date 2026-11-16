import { describe, expect, it } from 'vitest';
import { CALM_WINDOWS_TO_SHRINK, computePoolCap, decidePoolMax, type AutoscaleInput } from './pool-autoscale.js';

const input = (over: Partial<AutoscaleInput>): AutoscaleInput => ({
  current: 10,
  base: 10,
  cap: 30,
  waiting: 0,
  eventLoopDelayP99Ms: 20,
  state: { busyWindows: 0, calmWindows: 0 },
  ...over,
});

/** Chạy liên tiếp nhiều lượt đo với cùng tình trạng, trả số kết nối sau từng lượt. */
function run(windows: number, over: Partial<AutoscaleInput>, start = input({})) {
  let current = start.current;
  let state = start.state;
  const sizes: number[] = [];
  for (let i = 0; i < windows; i++) {
    ({ next: current, state } = decidePoolMax(input({ ...over, current, state })));
    sizes.push(current);
  }
  return sizes;
}

describe('computePoolCap (L4)', () => {
  it('chia ngân sách theo số bản đang chạy, không vượt trần mỗi bản, không dưới mức mặc định', () => {
    expect(computePoolCap({ base: 10, budget: 60, ceiling: 30, instances: 1 })).toBe(30);
    expect(computePoolCap({ base: 10, budget: 60, ceiling: 30, instances: 3 })).toBe(20);
    expect(computePoolCap({ base: 10, budget: 60, ceiling: 30, instances: 10 })).toBe(10);
  });
});

describe('decidePoolMax (L4)', () => {
  it('có request chờ kết nối 2 lượt liền mà Node còn rảnh thì tăng từng nấc 5, dừng ở trần', () => {
    expect(run(8, { waiting: 4 })).toEqual([10, 15, 15, 20, 20, 25, 25, 30]);
  });

  it('chờ kết nối nhưng event loop đang nghẽn (Node quá tải) thì không tăng', () => {
    expect(run(6, { waiting: 4, eventLoopDelayP99Ms: 250 })).toEqual([10, 10, 10, 10, 10, 10]);
  });

  it('yên 5 phút liền thì giảm một nấc, không xuống dưới mức mặc định', () => {
    const sizes = run(CALM_WINDOWS_TO_SHRINK * 2, {}, input({ current: 15 }));
    expect(sizes[CALM_WINDOWS_TO_SHRINK - 2]).toBe(15);
    expect(sizes[CALM_WINDOWS_TO_SHRINK - 1]).toBe(10);
    expect(sizes.at(-1)).toBe(10);
  });

  it('có thêm bản core-api làm trần thấp đi thì hạ ngay về trần mới', () => {
    expect(decidePoolMax(input({ current: 30, cap: 20, waiting: 5 })).next).toBe(20);
  });
});
