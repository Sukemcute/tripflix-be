import { HttpException } from '@nestjs/common';
import type { Response } from 'express';
import type { StaysUseCases } from '../application/stays.use-cases.js';
import { StaysController } from './stays.controller.js';

const QUERY = { placeId: 'da-nang', checkIn: '2099-12-01', checkOut: '2099-12-02', adults: '2' };

function setup(error: unknown) {
  const stays = { listStays: () => Promise.reject(error) } as unknown as StaysUseCases;
  const headers = new Map<string, string>();
  const res = { setHeader: (name: string, value: string) => headers.set(name, value) } as unknown as Response;
  return { controller: new StaysController(stays), res, headers };
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
