import { describe, expect, it } from 'vitest';
import { toCounts } from './drizzle-user-activity.store.js';

describe('toCounts', () => {
  it('đổi lastActiveAt dạng chuỗi của Postgres sang Date (lỗi 500 trên staging, SCRUM-177)', () => {
    const counts = toCounts({
      reactions: 1,
      comments: 0,
      shares: 0,
      views: 2,
      chats: 3,
      posts: 0,
      lastActiveAt: '2026-11-18 15:42:10.123+00',
    });
    expect(counts.lastActiveAt).toBeInstanceOf(Date);
    expect(counts.lastActiveAt?.toISOString()).toBe('2026-11-18T15:42:10.123Z');
  });

  it('giữ nguyên Date và trả null khi không có hoạt động', () => {
    const at = new Date('2026-11-18T15:42:10.123Z');
    expect(toCounts({ reactions: 0, comments: 0, shares: 0, views: 0, chats: 0, posts: 0, lastActiveAt: at }).lastActiveAt).toEqual(at);
    expect(toCounts(undefined)).toEqual({ reactions: 0, comments: 0, shares: 0, views: 0, chats: 0, posts: 0, lastActiveAt: null });
  });
});
