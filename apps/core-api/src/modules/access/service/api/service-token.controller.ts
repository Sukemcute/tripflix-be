import { Body, Controller, HttpCode, HttpStatus, Inject, Post, Req, UseFilters } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiProperty, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { SERVICE_TOKEN_TTL_SECONDS } from '@tripflix/auth';
import type { Request } from 'express';
import { z } from 'zod';
import { AccessErrorFilter, ZodBody, readRequestMeta } from '../../auth/api/http.js';
import { ServiceTokenUseCases } from '../application/service-token.use-cases.js';
import { INVALID_SERVICE_CREDENTIALS_MESSAGE } from '../domain/service-client-rules.js';

export const ServiceTokenRequestSchema = z.object({
  clientId: z.string().min(1).max(50),
  clientSecret: z.string().min(1).max(200),
  audience: z.string().min(1).max(50),
});

export class ServiceTokenRequestDto {
  @ApiProperty({ example: 'ai-service' }) clientId!: string;
  @ApiProperty({ description: 'Secret in ra một lần khi tạo client (auth:create-service-client)' }) clientSecret!: string;
  @ApiProperty({ example: 'core-api', description: 'Service sẽ nhận token (claim aud)' }) audience!: string;
}

export class ServiceTokenDto {
  @ApiProperty() accessToken!: string;
  @ApiProperty({ enum: ['Bearer'] }) tokenType!: 'Bearer';
  @ApiProperty({ example: SERVICE_TOKEN_TTL_SECONDS, description: 'Số giây token còn dùng được' }) expiresIn!: number;
}

/** Service xin token để gọi API nội bộ của service khác. Người dùng không dùng API này. */
@ApiTags('auth')
@Controller('auth')
@UseFilters(AccessErrorFilter)
export class ServiceTokenController {
  constructor(@Inject(ServiceTokenUseCases) private readonly serviceTokens: ServiceTokenUseCases) {}

  @Post('service-token')
  @HttpCode(HttpStatus.OK)
  @ApiBody({ type: ServiceTokenRequestDto })
  @ApiOkResponse({ type: ServiceTokenDto })
  @ApiUnauthorizedResponse({ description: INVALID_SERVICE_CREDENTIALS_MESSAGE })
  issue(@Body(new ZodBody(ServiceTokenRequestSchema)) body: z.infer<typeof ServiceTokenRequestSchema>, @Req() req: Request) {
    return this.serviceTokens.issueToken(body, readRequestMeta(req));
  }
}
