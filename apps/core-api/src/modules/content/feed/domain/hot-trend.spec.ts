import { calculateHotRaw, decayFactor, HOT_HALF_LIFE_HOURS, normalizeHotScores, percentile } from './hot-trend.js';

describe('decayFactor', () => {
  it('tương tác vừa xong giữ nguyên, sau 48 giờ còn một nửa, sau 96 giờ còn một phần tư', () => {
    expect(decayFactor(0)).toBe(1);
    expect(decayFactor(HOT_HALF_LIFE_HOURS)).toBeCloseTo(0.5, 10);
    expect(decayFactor(2 * HOT_HALF_LIFE_HOURS)).toBeCloseTo(0.25, 10);
  });

  it('thời điểm ở tương lai (lệch đồng hồ) không làm điểm lớn hơn 1', () => {
    expect(decayFactor(-5)).toBe(1);
  });
});

describe('calculateHotRaw', () => {
  it('bài không có tín hiệu thì 0 điểm, dù hoàn thiện đến đâu', () => {
    expect(calculateHotRaw(0, 1)).toBe(0);
  });

  it('bài hoàn thiện đủ được gấp đôi bài trống cùng tín hiệu', () => {
    expect(calculateHotRaw(9, 1)).toBeCloseTo(1, 10);
    expect(calculateHotRaw(9, 0)).toBeCloseTo(0.5, 10);
  });

  it('kẹp độ hoàn thiện và tín hiệu vào khoảng hợp lệ', () => {
    expect(calculateHotRaw(9, 2)).toBe(calculateHotRaw(9, 1));
    expect(calculateHotRaw(-3, 1)).toBe(0);
  });
});

describe('percentile', () => {
  it('nội suy tuyến tính như numpy', () => {
    expect(percentile([1, 2, 3, 4], 50)).toBe(2.5);
    expect(percentile([10], 99)).toBe(10);
    expect(percentile([], 99)).toBe(0);
  });
});

describe('normalizeHotScores', () => {
  it('chia theo p99 rồi kẹp về [0, 1], làm tròn 6 chữ số', () => {
    const raws = Array.from({ length: 100 }, (_, i) => ({ postId: `p${i}`, raw: i + 1 }));
    raws.push({ postId: 'spike', raw: 1_000 });

    const scored = normalizeHotScores(raws);

    expect(scored.find((row) => row.postId === 'spike')?.score).toBe(1);
    expect(scored.every((row) => row.score >= 0 && row.score <= 1)).toBe(true);
    expect(scored.find((row) => row.postId === 'p49')?.score).toBe(
      Math.round((50 / percentile(raws.map((r) => r.raw), 99)) * 1e6) / 1e6,
    );
  });

  it('cả lô đều 0 điểm thì không chia cho 0', () => {
    expect(normalizeHotScores([{ raw: 0 }, { raw: 0 }]).map((row) => row.score)).toEqual([0, 0]);
  });
});
