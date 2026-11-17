import type { ModuleRef } from '@nestjs/core';
import { CommerceFacade } from '../../../commerce/index.js';
import type { CommerceServicePort } from '../application/ports/commerce-service.port.js';

/**
 * Tích "đã đi" (TF105): đơn của chính người đăng, đã thanh toán và mọi mục đã kết thúc; kiểm ở commerce.
 * Lấy CommerceFacade lúc gọi (app gốc luôn có commerce) thay vì import CommerceModule, để test chỉ dựng content
 * không phải kéo theo database commerce; không có commerce thì coi như chưa xác thực.
 */
export function createCommerceServicePort(moduleRef: Pick<ModuleRef, 'get'>): CommerceServicePort {
  return {
    async verifyCompletedBooking(bookingId, userId) {
      let commerce: CommerceFacade;
      try {
        commerce = moduleRef.get(CommerceFacade, { strict: false });
      } catch {
        return false;
      }
      return commerce.verifyCompletedBooking(bookingId, userId);
    },
  };
}
