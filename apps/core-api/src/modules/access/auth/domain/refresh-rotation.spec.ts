import { REFRESH_GRACE_MS, decideRefresh, type RefreshState } from './refresh-rotation.js';

const now = new Date('2026-11-04T10:00:00Z');
const at = (ms: number) => new Date(now.getTime() + ms);

const session = (over: Partial<RefreshState> = {}): RefreshState => ({
  refreshTokenHash: 'h2',
  previousTokenHash: 'h1',
  rotatedAt: at(-60_000),
  expiresAt: at(86_400_000),
  ...over,
});

describe('decideRefresh', () => {
  it('xoay vòng khi đúng token hiện tại', () => {
    expect(decideRefresh(session(), 'h2', now)).toBe('rotate');
  });

  it('nhận token liền trước trong 10 giây sau lần xoay', () => {
    expect(decideRefresh(session({ rotatedAt: at(-3_000) }), 'h1', now)).toBe('grace');
    expect(decideRefresh(session({ rotatedAt: at(-REFRESH_GRACE_MS) }), 'h1', now)).toBe('grace');
  });

  it('coi là dùng lại token cũ khi quá 10 giây', () => {
    expect(decideRefresh(session({ rotatedAt: at(-REFRESH_GRACE_MS - 1) }), 'h1', now)).toBe('reuse');
  });

  it('từ chối token không khớp', () => {
    expect(decideRefresh(session(), 'h0', now)).toBe('invalid');
    expect(decideRefresh(session({ previousTokenHash: null }), 'h1', now)).toBe('invalid');
  });

  it('từ chối khi phiên đã hết hạn, kể cả đúng token', () => {
    expect(decideRefresh(session({ expiresAt: now }), 'h2', now)).toBe('invalid');
  });
});
