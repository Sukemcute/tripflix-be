import { HttpException } from '@nestjs/common';
import type { Response } from 'express';
import type { SearchEventsPublisher } from '../application/search-events.publisher.js';
import type { StaysUseCases } from '../application/stays.use-cases.js';
import { StaysController } from './stays.controller.js';

const QUERY = { placeId: 'da-nang', checkIn: '2099-12-01', checkOut: '2099-12-02', adults: '2' };

function setup(error: unknown) {
  const stays = { listStays: () => Promise.reject(error) } as unknown as StaysUseCases;
  const headers = new Map<string, string>();
  const res = { setHeader: (name: string, value: string) => headers.set(name, value) } as unknown as Response;
  const searchEvents = { staysSearched: vi.fn() } as unknown as SearchEventsPublisher;
  return { controller: new StaysController(stays, searchEvents), res, headers };
}

describe('StaysController khi database lỗi', () => {
  it('database tắt thì trả 503 kèm Retry-After, không phải 500', async () => {
    const { controller, res, headers } = setup(new Error('query failed', { cause: { code: 'ECONNREFUSED' } }));
    const error = await controller.listStays(QUERY, res).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(503);
    expect((error as HttpException).getResponse()).toMatchObject({ reason: 'SERVICE_UNAVAILABLE' });
    expect(headers.get('Retry-After')).toBe('5');
  });

  it('lỗi khác giữ nguyên như cũ', async () => {
    const boom = new Error('boom');
    const { controller, res, headers } = setup(boom);
    await expect(controller.listStays(QUERY, res)).rejects.toBe(boom);
    expect(headers.size).toBe(0);
  });
});

describe('StaysController phát sự kiện tìm chỗ ở', () => {
  const page = { items: [], total: 4, nextCursor: null };
  const make = () => {
    const staysSearched = vi.fn();
    const stays = { listStays: () => Promise.resolve(page) } as unknown as StaysUseCases;
    const controller = new StaysController(stays, { staysSearched } as unknown as SearchEventsPublisher);
    return { controller, staysSearched, res: {} as Response };
  };
  const user = { userId: '11111111-1111-4111-8111-111111111111', role: 'member' as const, sid: 's', exp: 0 };

  it('có user, trang đầu: phát với số kết quả; khách hoặc trang sau thì không, kết quả như cũ', async () => {
    const { controller, staysSearched, res } = make();
    expect(await controller.listStays({ ...QUERY, minStars: '4' }, res, user)).toBe(page);
    expect(staysSearched).toHaveBeenCalledWith(user.userId, {
      placeId: 'da-nang', checkIn: '2099-12-01', checkOut: '2099-12-02', adults: 2, rooms: null, minStars: 4, priceMax: null, resultCount: 4,
    });
    expect(await controller.listStays(QUERY, res)).toBe(page);
    await controller.listStays({ ...QUERY, cursor: '20' }, res, user);
    expect(staysSearched).toHaveBeenCalledTimes(1);
  });
});
