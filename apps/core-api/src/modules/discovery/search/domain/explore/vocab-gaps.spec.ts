import { keyness, queryGrams, rankVocabGaps } from './vocab-gaps.js';

describe('keyness (G²)', () => {
  it('khớp giá trị tính tay: a=10/A=100, c=0/C=1000 -> 2·10·ln(11)', () => {
    expect(keyness(10, 100, 0, 1000)).toBeCloseTo(20 * Math.log(11), 6);
  });

  it('người tìm dùng không nhiều hơn nội dung thì 0', () => {
    expect(keyness(1, 100, 10, 1000)).toBe(0);
    expect(keyness(1, 100, 50, 1000)).toBe(0);
    expect(keyness(0, 100, 0, 1000)).toBe(0);
    expect(keyness(3, 0, 0, 1000)).toBe(0);
  });

  it('cùng tỉ lệ trong câu tìm: nội dung càng ít dùng thì điểm càng cao', () => {
    expect(keyness(10, 100, 0, 1000)).toBeGreaterThan(keyness(10, 100, 5, 1000));
  });
});

describe('queryGrams', () => {
  it('unigram + bigram của seq, bỏ n-gram mà mọi từ đều đã khớp lexicon; tổng tính cả n-gram đã bỏ', () => {
    const r = queryGrams({ seq: ['an', 'gi', 'ha', 'loi'], matched: [['an gi', 'intent', 'eat']] });
    expect(r.grams).toEqual(['ha', 'loi', 'gi ha', 'ha loi']);
    expect(r.totals).toEqual({ 1: 4, 2: 3 });
  });

  it('bỏ trùng trong một câu', () => {
    expect(queryGrams({ seq: ['loi', 'loi'], matched: [] }).grams).toEqual(['loi', 'loi loi']);
  });
});

describe('rankVocabGaps', () => {
  const content = (counts: Record<string, number>) => ({ count: (g: string) => counts[g] ?? 0, totals: { 1: 10_000, 2: 9_000 } });

  it('cụm hai từ quen nhưng chưa ai viết lên trên từ phổ biến ở cả hai phía', () => {
    const rows = [
      { gram: 'ha', hits: 30, samples: [] },
      { gram: 'loi', hits: 20, samples: [] },
      { gram: 'ha loi', hits: 20, samples: ['hà lội ăn gì'] },
      { gram: 'homestay', hits: 25, samples: [] },
    ];
    const gaps = rankVocabGaps(rows, { 1: 200, 2: 100 }, content({ ha: 300, loi: 80, homestay: 3_000, 'ha loi': 0 }));
    expect(gaps[0]).toMatchObject({ gram: 'ha loi', n: 2, contentCount: 0, queryHits: 20, samples: ['hà lội ăn gì'] });
    expect(gaps.map((g) => g.gram)).not.toContain('homestay');
  });

  it('gom kiểu viết gần nhau cùng bậc, cộng lượt, gộp câu mẫu tối đa 5', () => {
    const rows = [
      { gram: 'ha loi', hits: 9, samples: ['a', 'b', 'c'] },
      { gram: 'ha loii', hits: 4, samples: ['c', 'd', 'e', 'f'] },
      { gram: 'haloi', hits: 3, samples: [] },
    ];
    const [g, ...rest] = rankVocabGaps(rows, { 1: 100, 2: 100 }, content({}));
    expect(g).toMatchObject({ gram: 'ha loi', queryHits: 13, samples: ['a', 'b', 'c', 'd', 'e'] });
    expect(g!.variants).toEqual([
      { gram: 'ha loi', queryHits: 9 },
      { gram: 'ha loii', queryHits: 4 },
    ]);
    expect(rest.map((x) => x.gram)).toEqual(['haloi']); // unigram: khác bậc, không gom
  });
});
