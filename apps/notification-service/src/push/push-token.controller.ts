import { BadRequestException, Body, Controller, Delete, HttpCode, Inject, Post } from '@nestjs/common';
import { Authenticated, CurrentUser, type AuthUser } from '@tripflix/auth';
import { z } from 'zod';
import { PushPlatformSchema, PushTokenSchema, PushWorker } from './push.worker.js';

const RegisterPushTokenSchema = z.object({ token: PushTokenSchema, platform: PushPlatformSchema }).strict();
const RemovePushTokenSchema = z.object({ token: PushTokenSchema }).strict();

/** N3: app gửi Expo push token sau khi đăng nhập, xoá khi đăng xuất. */
@Controller('push-tokens')
export class PushTokenController {
  constructor(@Inject(PushWorker) private readonly push: PushWorker) {}

  @Post()
  @Authenticated()
  @HttpCode(204)
  async register(@CurrentUser() user: AuthUser, @Body() body: unknown): Promise<void> {
    const parsed = RegisterPushTokenSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Mã thiết bị không hợp lệ');
    await this.push.registerToken(user.userId, parsed.data.token, parsed.data.platform);
  }

  @Delete()
  @Authenticated()
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Body() body: unknown): Promise<void> {
    const parsed = RemovePushTokenSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Mã thiết bị không hợp lệ');
    await this.push.removeToken(user.userId, parsed.data.token);
  }
}
