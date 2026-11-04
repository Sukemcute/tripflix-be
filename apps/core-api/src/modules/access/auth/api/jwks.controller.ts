import { Controller, Get, Header, Inject } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { TOKEN_ISSUER, type TokenIssuer } from '../application/ports.js';
import { JwksDto } from './dto.js';

/** Khoá công khai để gateway và service khác tự kiểm access token. Nằm ngoài tiền tố /api. */
@ApiTags('auth')
@Controller('.well-known')
export class JwksController {
  constructor(@Inject(TOKEN_ISSUER) private readonly tokens: TokenIssuer) {}

  @Get('jwks.json')
  @Header('Cache-Control', 'public, max-age=300')
  @ApiOkResponse({ type: JwksDto })
  jwks() {
    return this.tokens.jwks();
  }
}
