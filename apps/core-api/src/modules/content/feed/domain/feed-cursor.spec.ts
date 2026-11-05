import { describe, expect, it } from 'vitest';
import { decodeFeedCursor, encodeFeedCursor } from './feed-cursor.js';

const VALID = { at: '2026-11-05T10:00:00.123456Z', id: '018d9f20-0000-7000-8000-000000000001' };
const encodeRaw = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

describe('feed cursor', () => {
  it('giữ nguyên đủ micro-giây sau khi mã hoá rồi giải mã', () => {
    expect(decodeFeedCursor(encodeFeedCursor(VALID))).toEqual(VALID);
  });

  it.each([
    ['không phải base64 JSON', 'khong-hop-le'],
    ['thiếu id', encodeRaw({ at: VALID.at })],
    ['id không phải UUID', encodeRaw({ ...VALID, id: 'abc' })],
    ['thời gian chỉ tới mili-giây', encodeRaw({ ...VALID, at: '2026-11-05T10:00:00.123Z' })],
    ['ngày không có thật', encodeRaw({ ...VALID, at: '2026-02-31T10:00:00.123456Z' })],
    ['JSON không phải object', encodeRaw(null)],
  ])('trả null khi %s', (_name, value) => {
    expect(decodeFeedCursor(value)).toBeNull();
  });
});
