import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Inject,
  Logger,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { Authenticated, CurrentUser, type AuthUser } from '@tripflix/auth';
import { z } from 'zod';
import { RealtimeService } from '../realtime/realtime.service.js';
import { decodeInboxCursor, InboxRepository, toInboxItemDto, type InboxItemDto } from './inbox.repository.js';

export const InboxQuerySchema = z.object({
  tab: z.enum(['all', 'orders', 'interactions']).optional(),
  cursor: z
    .string()
    .max(1024)
    .refine((value) => {
      try {
        decodeInboxCursor(value);
        return true;
      } catch {
        return false;
      }
    }, 'Con trỏ không hợp lệ')
    .optional(),
  limit: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1).max(50)).default(20),
});

const ReadAllBodySchema = z.object({ throughId: z.uuid().optional() }).strict().optional();

@Controller()
export class InboxController {
  private readonly logger = new Logger(InboxController.name);

  constructor(
    @Inject(InboxRepository) private readonly inbox: InboxRepository,
    @Inject(RealtimeService) private readonly realtime: RealtimeService,
  ) {}

  @Get()
  @Authenticated()
  @Header('Cache-Control', 'no-store')
  async list(
    @CurrentUser() user: AuthUser,
    @Query() query: unknown,
  ): Promise<{
    items: InboxItemDto[];
    unreadCount: number;
    nextCursor: string | null;
  }> {
    const parsed = InboxQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException('Tham số thông báo không hợp lệ');
    const page = await this.inbox.listForUser(user.userId, parsed.data);
    return {
      items: page.items.map(toInboxItemDto),
      unreadCount: await this.inbox.countUnread(user.userId),
      nextCursor: page.nextCursor,
    };
  }

  @Get('unread-count')
  @Authenticated()
  @Header('Cache-Control', 'no-store')
  async unreadCount(@CurrentUser() user: AuthUser): Promise<{ unreadCount: number }> {
    return { unreadCount: await this.inbox.countUnread(user.userId) };
  }

  @Post('read-all')
  @Authenticated()
  async markAllRead(@CurrentUser() user: AuthUser, @Body() body?: unknown): Promise<{ unreadCount: number }> {
    const parsed = ReadAllBodySchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Mốc thông báo không hợp lệ');
    const throughId = parsed.data?.throughId;
    if (throughId) {
      if (!(await this.inbox.markAllReadThrough(user.userId, throughId))) {
        throw new NotFoundException('Không tìm thấy thông báo');
      }
    } else {
      await this.inbox.markAllRead(user.userId);
    }
    return this.emitRead(user.userId, throughId ? { throughId } : {});
  }

  @Post(':id/read')
  @Authenticated()
  async markRead(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<{ unreadCount: number }> {
    if (!z.uuid().safeParse(id).success) throw new BadRequestException('Mã thông báo không hợp lệ');
    if (!(await this.inbox.markRead(user.userId, id)))
      throw new NotFoundException('Không tìm thấy thông báo');
    return this.emitRead(user.userId, { id });
  }

  private async emitRead(userId: string, change: { id?: string; throughId?: string }): Promise<{ unreadCount: number }> {
    const unreadCount = await this.inbox.countUnread(userId);
    try {
      this.realtime.emitToUser(userId, 'notification.read', { ...change, unreadCount });
    } catch {
      this.logger.warn('Không phát được trạng thái đọc thông báo');
    }
    return { unreadCount };
  }
}
