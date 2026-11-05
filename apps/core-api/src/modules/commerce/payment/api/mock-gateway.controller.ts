import { Body, Controller, Get, HttpCode, HttpStatus, Inject, NotFoundException, Post } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import { CreateTokenRequestDto, CreateTokenRequestSchema, TokenDto } from '../../booking/api/checkout.dto.js';
import { ZodQuery } from '../../inventory/api/http.js';
import { PAYMENT_GATEWAY, type PaymentGateway } from '../application/gateway.port.js';
import { MockGateway, TEST_CARDS } from '../infra/mock-gateway.js';

/**
 * Cổng giả lập đóng vai form thẻ của cổng thật (Stripe.js): thẻ đổi lấy token, API đặt chỗ chỉ thấy token.
 * Chỉ dùng được khi PAYMENT_GATEWAY=mock; cổng thật thì 404.
 */
@ApiTags('mock-gateway')
@Controller('mock-gateway')
export class MockGatewayController {
  constructor(@Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway) {}

  @Post('tokens')
  @HttpCode(HttpStatus.OK)
  @ApiBody({ type: CreateTokenRequestDto })
  @ApiOkResponse({ type: TokenDto })
  createToken(@Body(new ZodQuery(CreateTokenRequestSchema)) body: z.infer<typeof CreateTokenRequestSchema>) {
    return this.mock().createToken(body.cardNumber);
  }

  @Get('test-cards')
  listTestCards() {
    this.mock();
    return TEST_CARDS.map(({ number, label, outcome }) => ({ number, label, outcome }));
  }

  private mock(): MockGateway {
    if (!(this.gateway instanceof MockGateway)) throw new NotFoundException();
    return this.gateway;
  }
}
