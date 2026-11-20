import { type CanActivate, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PAYMENT_GATEWAY, type PaymentGateway } from '../application/gateway.port.js';

@Injectable()
export class CardPaymentGuard implements CanActivate {
  constructor(@Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway | null) {}

  // Chặn trước IdempotencyInterceptor để cả phản hồi demo lưu từ trước cũng không được phát lại.
  canActivate(): boolean {
    if (!this.gateway) throw new NotFoundException('Thanh toán bằng token thẻ không khả dụng.');
    return true;
  }
}
