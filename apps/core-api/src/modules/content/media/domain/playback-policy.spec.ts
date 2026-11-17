import { buildPlaybackPolicy, buildPlaybackResource } from './playback-policy.js';

describe('playback policy', () => {
  it('mở mọi file dưới gốc CDN, bỏ dấu / thừa ở cuối', () => {
    expect(buildPlaybackResource('https://media.tripflix.io.vn/')).toBe('https://media.tripflix.io.vn/*');
    expect(buildPlaybackResource('https://media.tripflix.io.vn')).toBe('https://media.tripflix.io.vn/*');
  });

  it('hết hạn tính bằng giây, làm tròn xuống', () => {
    const policy = JSON.parse(buildPlaybackPolicy('https://cdn.test/*', new Date('2026-11-17T06:00:00.900Z'))) as unknown;
    expect(policy).toEqual({
      Statement: [
        { Resource: 'https://cdn.test/*', Condition: { DateLessThan: { 'AWS:EpochTime': Date.UTC(2026, 10, 17, 6) / 1000 } } },
      ],
    });
  });
});
