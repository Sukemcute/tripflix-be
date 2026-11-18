import { describe, expect, it } from 'vitest';
import { bucketStart, fillBuckets, type AiTimePoint } from './ai-insights.js';

const point = (at: string, calls: number): AiTimePoint => ({ at: new Date(at), calls, inputTokens: calls * 10, outputTokens: calls, costUsd: calls / 1000 });

describe('bucketStart', () => {
  it('ngày bắt đầu 00:00 giờ Việt Nam (17:00 UTC hôm trước)', () => {
    // 02:30 ngày 18 ở Việt Nam là 19:30 UTC ngày 17.
    expect(bucketStart(new Date('2026-11-17T19:30:00Z'), 'day').toISOString()).toBe('2026-11-17T17:00:00.000Z');
  });

  it('giờ cắt về đầu giờ', () => {
    expect(bucketStart(new Date('2026-11-17T19:30:45Z'), 'hour').toISOString()).toBe('2026-11-17T19:00:00.000Z');
  });
});

describe('fillBuckets', () => {
  it('điền 0 cho ngày không có dữ liệu và giữ dữ liệu có sẵn', () => {
    const from = new Date('2026-11-16T17:00:00Z'); // 00:00 ngày 17 ở Việt Nam
    const to = new Date('2026-11-19T17:00:00Z'); // hết ngày 19
    const filled = fillBuckets([point('2026-11-17T17:00:00Z', 5)], from, to, 'day');

    expect(filled.map((p) => [p.at.toISOString(), p.calls])).toEqual([
      ['2026-11-16T17:00:00.000Z', 0],
      ['2026-11-17T17:00:00.000Z', 5],
      ['2026-11-18T17:00:00.000Z', 0],
    ]);
  });

  it('khoảng một ngày theo giờ có 24 bucket', () => {
    const from = new Date('2026-11-17T17:00:00Z');
    expect(fillBuckets([], from, new Date(from.getTime() + 86_400_000), 'hour')).toHaveLength(24);
  });
});
