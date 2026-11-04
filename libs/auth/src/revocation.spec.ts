import { MemorySidBlocklist, RedisSidBlocklist, buildRevokedSidKey } from './revocation.js';

describe('MemorySidBlocklist', () => {
  it('chặn sid tới khi hết thời hạn', async () => {
    let now = 0;
    const list = new MemorySidBlocklist(() => now);
    await list.block('s-1', 60);
    expect(await list.isBlocked('s-1')).toBe(true);
    now = 61_000;
    expect(await list.isBlocked('s-1')).toBe(false);
  });
});

describe('RedisSidBlocklist', () => {
  it('ghi khoá auth:revoked-sid:<sid> với thời hạn EX', async () => {
    const calls: unknown[][] = [];
    const redis = {
      set: async (...args: unknown[]) => {
        calls.push(args);
        return 'OK' as const;
      },
      exists: async () => 1,
    };
    const list = new RedisSidBlocklist(redis as never);
    await list.block('s-1', 12.3);
    expect(calls[0]).toEqual([buildRevokedSidKey('s-1'), '1', 'EX', 13]);
    expect(await list.isBlocked('s-1')).toBe(true);
  });
});
