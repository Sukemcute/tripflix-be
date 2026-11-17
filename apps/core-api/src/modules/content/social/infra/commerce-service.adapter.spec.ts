import type { ModuleRef } from '@nestjs/core';
import { CommerceFacade } from '../../../commerce/index.js';
import { createCommerceServicePort } from './commerce-service.adapter.js';

describe('createCommerceServicePort (TF105)', () => {
  it('hỏi commerce đúng đơn và người đăng', async () => {
    const verifyCompletedBooking = vi.fn(async () => true);
    const moduleRef = { get: vi.fn(() => ({ verifyCompletedBooking })) } as unknown as Pick<ModuleRef, 'get'>;
    await expect(createCommerceServicePort(moduleRef).verifyCompletedBooking('order-1', 'user-1')).resolves.toBe(true);
    expect(moduleRef.get).toHaveBeenCalledWith(CommerceFacade, { strict: false });
    expect(verifyCompletedBooking).toHaveBeenCalledWith('order-1', 'user-1');
  });

  it('không có commerce trong app thì coi như chưa xác thực', async () => {
    const moduleRef = {
      get: vi.fn(() => {
        throw new Error('not found');
      }),
    } as unknown as Pick<ModuleRef, 'get'>;
    await expect(createCommerceServicePort(moduleRef).verifyCompletedBooking('order-1', 'user-1')).resolves.toBe(false);
  });
});
