import { Body, Controller, Get, HttpCode, HttpException, HttpStatus, Inject, Param, ParseUUIDPipe, Post, Put, UseFilters } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Authenticated, CurrentUser, type AuthUser } from '@tripflix/auth';
import { Idempotent } from '@tripflix/idempotency';
import type { z } from 'zod';
import { CommerceErrorFilter, IDEMPOTENCY_KEY_HEADER, ZodQuery } from '../../inventory/api/http.js';
import { PaymentUseCases } from '../../payment/application/payment.use-cases.js';
import { CheckoutUseCases } from '../application/checkout.use-cases.js';
import {
  CheckoutDto,
  CheckoutRequestDto,
  CheckoutRequestSchema,
  ConfirmThreeDsRequestDto,
  ConfirmThreeDsRequestSchema,
  PayRequestDto,
  PayRequestSchema,
  PayResultDto,
  SetGuestsRequestDto,
  SetGuestsRequestSchema,
} from './checkout.dto.js';

/**
 * Đặt chỗ và trả tiền. Lệnh ghi gửi lại được (mất mạng, bấm hai lần) phải kèm header Idempotency-Key:
 * app tạo UUID một lần cho mỗi thao tác và gửi lại đúng key đó khi thử lại.
 */
@ApiTags('checkout')
@ApiBearerAuth()
@Controller('checkout')
@UseFilters(CommerceErrorFilter)
@Authenticated()
export class CheckoutController {
  constructor(
    @Inject(CheckoutUseCases) private readonly checkout: CheckoutUseCases,
    @Inject(PaymentUseCases) private readonly payment: PaymentUseCases,
  ) {}

  /** Giữ chỗ cả giỏ 30 phút và tạo đơn. Một mục không đủ chỗ thì không giữ gì (409, kèm mục bị thiếu). */
  @Post()
  @Idempotent()
  @ApiHeader(IDEMPOTENCY_KEY_HEADER)
  @ApiBody({ type: CheckoutRequestDto })
  @ApiOkResponse({ type: CheckoutDto })
  create(@CurrentUser() user: AuthUser, @Body(new ZodQuery(CheckoutRequestSchema)) body: z.infer<typeof CheckoutRequestSchema>) {
    return this.checkout.checkout(user.userId, body);
  }

  @Get(':id')
  @ApiOkResponse({ type: CheckoutDto })
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.checkout.getCheckout(user.userId, id);
  }

  @Put(':id/guests')
  @ApiBody({ type: SetGuestsRequestDto })
  setGuests(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodQuery(SetGuestsRequestSchema)) body: z.infer<typeof SetGuestsRequestSchema>) {
    return this.checkout.setGuests(user.userId, id, {
      contact: { fullName: body.contact.fullName, phone: body.contact.phone, email: body.contact.email ?? null },
      guests: body.guests.map((g) => ({ fullName: g.fullName, birthdate: g.birthdate ?? null })),
    });
  }

  /** Trả tiền. 200 paid; 200 requires_action (gửi OTP tới /3ds); 202 pending (chưa rõ kết quả, đừng trả lại). */
  @Post(':id/pay')
  @Idempotent()
  @ApiHeader(IDEMPOTENCY_KEY_HEADER)
  @HttpCode(HttpStatus.OK)
  @ApiBody({ type: PayRequestDto })
  @ApiOkResponse({ type: PayResultDto })
  async pay(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodQuery(PayRequestSchema)) body: z.infer<typeof PayRequestSchema>) {
    const result = await this.payment.pay(user.userId, id, body);
    // 202 trả bằng exception để kết quả "chưa rõ" không bị lưu làm kết quả cuối của Idempotency-Key: gửi lại thì xem lại trạng thái thật.
    if (result.outcome === 'pending') throw new HttpException(result, HttpStatus.ACCEPTED);
    return result;
  }

  @Post(':id/3ds')
  @Idempotent()
  @ApiHeader(IDEMPOTENCY_KEY_HEADER)
  @HttpCode(HttpStatus.OK)
  @ApiBody({ type: ConfirmThreeDsRequestDto })
  @ApiOkResponse({ type: PayResultDto })
  confirm3ds(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodQuery(ConfirmThreeDsRequestSchema)) body: z.infer<typeof ConfirmThreeDsRequestSchema>) {
    return this.payment.confirm3ds(user.userId, id, body);
  }

  /** Huỷ giỏ đang giữ, trả chỗ về kho. Gọi lại nhiều lần vẫn ra cùng kết quả. */
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.checkout.cancelHold(user.userId, id);
  }
}
