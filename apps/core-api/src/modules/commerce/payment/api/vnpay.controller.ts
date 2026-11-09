import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Post, Query, Req, UseFilters } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOkResponse, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { AllowWhenRevocationUnavailable, Authenticated, CurrentUser, type AuthUser } from '@tripflix/auth';
import { Idempotent } from '@tripflix/idempotency';
import type { Request } from 'express';
import { z } from 'zod';
import { CommerceErrorFilter, IDEMPOTENCY_KEY_HEADER, ZodQuery } from '../../inventory/api/http.js';
import { VnpayUseCases } from '../application/vnpay.use-cases.js';

export const StartVnpayRequestSchema = z
  .object({
    expectedTotal: z.number().int().positive(),
    acceptedPolicyVersion: z.string().min(1).max(20),
    bankCode: z.enum(['VNPAYQR', 'VNBANK', 'INTCARD']).optional(),
  })
  .strict();

class StartVnpayRequestDto {
  @ApiProperty({ description: 'Tổng tiền khách đang thấy; khác giá hiện tại thì 409 PRICE_CHANGED' }) expectedTotal!: number;
  @ApiProperty({ example: '2026-11-03' }) acceptedPolicyVersion!: string;
  @ApiPropertyOptional({ enum: ['VNPAYQR', 'VNBANK', 'INTCARD'], description: 'Bỏ trống: khách tự chọn trên trang VNPay. VNPAYQR: vào thẳng màn mã QR' }) bankCode?: string;
}

class StartVnpayResultDto {
  @ApiProperty({ description: 'Chuyển trình duyệt / WebView tới URL này' }) paymentUrl!: string;
  @ApiProperty({ format: 'date-time' }) expiresAt!: string;
}

class VnpayReturnResultDto {
  @ApiProperty({ type: String, nullable: true, format: 'uuid' }) orderId!: string | null;
  @ApiProperty() isValidSignature!: boolean;
  @ApiProperty() isSuccess!: boolean;
}

/** Bắt đầu thanh toán VNPay cho một đơn đang giữ chỗ. Cần đăng nhập và Idempotency-Key. */
@ApiTags('checkout')
@ApiBearerAuth()
@Controller('checkout')
@UseFilters(CommerceErrorFilter)
@Authenticated()
@AllowWhenRevocationUnavailable()
export class VnpayCheckoutController {
  constructor(@Inject(VnpayUseCases) private readonly vnpay: VnpayUseCases) {}

  @Post(':id/pay-vnpay')
  @Idempotent()
  @ApiHeader(IDEMPOTENCY_KEY_HEADER)
  @HttpCode(HttpStatus.OK)
  @ApiBody({ type: StartVnpayRequestDto })
  @ApiOkResponse({ type: StartVnpayResultDto })
  start(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodQuery(StartVnpayRequestSchema)) body: z.infer<typeof StartVnpayRequestSchema>, @Req() req: Request) {
    return this.vnpay.startPayment(user.userId, id, { ...body, clientIp: req.ip ?? '127.0.0.1' });
  }
}

/**
 * Đường VNPay gọi về. Không cần token người dùng: tin cậy nhờ chữ ký HMAC-SHA512 với vnp_HashSecret.
 * Gateway phải cho /api/payments/vnpay/* đi qua không kiểm token.
 */
@ApiTags('payments')
@Controller('payments/vnpay')
@UseFilters(CommerceErrorFilter)
export class VnpayCallbackController {
  constructor(@Inject(VnpayUseCases) private readonly vnpay: VnpayUseCases) {}

  /** IPN (server VNPay gọi server mình): trả RspCode theo quy ước của VNPay. */
  @Get('ipn')
  ipn(@Query() query: Record<string, string>) {
    return this.vnpay.handleIpn(query);
  }

  /** Return URL: trình duyệt quay về sau khi trả; web / app đọc kết quả để hiện màn thành công hay thất bại. */
  @Get('return')
  @ApiOkResponse({ type: VnpayReturnResultDto })
  return(@Query() query: Record<string, string>) {
    return this.vnpay.handleReturn(query);
  }
}
