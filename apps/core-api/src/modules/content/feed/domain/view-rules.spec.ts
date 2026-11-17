import { describe, expect, it } from 'vitest';
import { isQualifiedView } from './view-rules.js';

describe('isQualifiedView', () => {
  it('từ 15 giây là xem thật, kể cả video dài', () => {
    expect(isQualifiedView(14_999, 120)).toBe(false);
    expect(isQualifiedView(15_000, 120)).toBe(true);
  });

  it('video ngắn xem được nửa thời lượng là xem thật', () => {
    expect(isQualifiedView(3_999, 8)).toBe(false);
    expect(isQualifiedView(4_000, 8)).toBe(true);
  });

  it('chưa biết thời lượng thì chỉ xét mốc 15 giây', () => {
    expect(isQualifiedView(10_000, null)).toBe(false);
    expect(isQualifiedView(15_000, null)).toBe(true);
  });
});
