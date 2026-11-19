import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Inject,
  Post,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Authenticated, CurrentUser, type AuthUser } from '@tripflix/auth';
import { ENV } from '../tokens.js';
import type { Env } from '../env.js';
import { WebPushWorker } from './web-push.worker.js';
import { SubscriptionSchema, RemoveSubscriptionSchema } from './web-push.validation.js';

@Controller('web-push')
export class WebPushController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(WebPushWorker) private readonly push: WebPushWorker,
  ) {}

  @Get()
  @Authenticated()
  @Header('Cache-Control', 'no-store')
  configuration() {
    return {
      enabled: this.env.WEB_PUSH_ENABLED,
      publicKey: this.env.WEB_PUSH_ENABLED ? (this.env.WEB_PUSH_PUBLIC_KEY ?? null) : null,
    };
  }

  @Post()
  @Authenticated()
  @Header('Cache-Control', 'no-store')
  async register(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    if (!this.env.WEB_PUSH_ENABLED) throw new ServiceUnavailableException('Chưa bật Web Push');
    const parsed = SubscriptionSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Thiết bị không hợp lệ');
    const id = await this.push.register(user, parsed.data);
    return { id, userId: user.userId };
  }

  @Delete()
  @Authenticated()
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const parsed = RemoveSubscriptionSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Thiết bị không hợp lệ');
    await this.push.remove(user.userId, parsed.data.endpoint);
  }
}
