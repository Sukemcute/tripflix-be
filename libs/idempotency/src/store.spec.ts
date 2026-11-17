import { describe, expect, it } from 'vitest';
import { MemoryIdempotencyStore, STALE_PROCESSING_SECONDS } from './store.js';

describe('MemoryIdempotencyStore: key processing quá hạn (L3)', () => {
  it('tiến trình chết giữa chừng: quá 60 giây thì request mới giữ lại được', async () => {
    let now = 0;
    const store = new MemoryIdempotencyStore(() => now);
    expect(await store.begin('s', 'k', 'h', 86_400)).toEqual({ kind: 'started' });
    now += (STALE_PROCESSING_SECONDS - 1) * 1000;
    expect(await store.begin('s', 'k', 'h', 86_400)).toEqual({ kind: 'in_progress', requestHash: 'h' });
    now += 2_000;
    expect(await store.begin('s', 'k', 'h', 86_400)).toEqual({ kind: 'started' });
  });

  it('đã completed thì không bị coi là quá hạn', async () => {
    let now = 0;
    const store = new MemoryIdempotencyStore(() => now);
    await store.begin('s', 'k', 'h', 86_400);
    await store.complete('s', 'k', 201, { id: 1 });
    now += 3_600_000;
    expect(await store.begin('s', 'k', 'h', 86_400)).toMatchObject({ kind: 'replay', responseStatus: 201 });
  });
});
