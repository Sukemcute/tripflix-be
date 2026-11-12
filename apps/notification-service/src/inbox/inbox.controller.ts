import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { Authenticated, CurrentUser, type AuthUser } from '@tripflix/auth';
import { z } from 'zod';
import { decodeInboxCursor, InboxRepository, toInboxItemDto, type InboxItemDto } from './inbox.repository.js';

export const InboxQuerySchema = z.object({
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

@Controller()
export class InboxController {
  constructor(@Inject(InboxRepository) private readonly inbox: InboxRepository) {}

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

  @Post('read-all')
  @Authenticated()
  async markAllRead(@CurrentUser() user: AuthUser): Promise<{ unreadCount: number }> {
    await this.inbox.markAllRead(user.userId);
    return { unreadCount: 0 };
  }

  @Post(':id/read')
  @Authenticated()
  async markRead(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<{ unreadCount: number }> {
    if (!z.uuid().safeParse(id).success) throw new BadRequestException('Mã thông báo không hợp lệ');
    if (!(await this.inbox.markRead(user.userId, id)))
      throw new NotFoundException('Không tìm thấy thông báo');
    return { unreadCount: await this.inbox.countUnread(user.userId) };
  }
}
