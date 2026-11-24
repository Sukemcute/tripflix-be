import { decodeCursor, decodeSyncCursor } from './cursor.js';

function encodePayload(payload: object): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

describe('cursor', () => {
  it('bỏ qua cursor có createdAt không phải ngày hợp lệ', () => {
    expect(decodeCursor(encodePayload({ createdAt: 'abc', id: 'post-1' }))).toBeUndefined();
  });

  it('bỏ qua sync cursor có updatedAt không phải ngày hợp lệ', () => {
    expect(decodeSyncCursor(encodePayload({ updatedAt: 'abc', id: 'post-1' }))).toBeUndefined();
  });
});
