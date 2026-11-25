import { afterEach, describe, expect, it, vi } from 'vitest';
import { PLACES_SNAPSHOT_TTL_MS, PlacesUseCases } from './places.use-cases.js';

describe('PlacesUseCases', () => {
  afterEach(() => vi.useRealTimers());

  it('giữ bản đọc điểm 60 giây, hết hạn thì đọc lại; lỗi thì không giữ', async () => {
    vi.useFakeTimers();
    const store = { listPlaces: vi.fn(async () => []), listPoints: vi.fn(async () => []) };
    const places = new PlacesUseCases(store);
    const query = { city: 'da-lat', radiusKm: 15, limit: 40 } as Parameters<PlacesUseCases['find']>[0];

    await Promise.all([places.find(query), places.find(query)]);
    expect(store.listPoints).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(PLACES_SNAPSHOT_TTL_MS);
    store.listPoints.mockRejectedValueOnce(new Error('db'));
    await expect(places.find(query)).rejects.toThrow('db');
    await places.find(query);
    expect(store.listPoints).toHaveBeenCalledTimes(3);
  });
});
