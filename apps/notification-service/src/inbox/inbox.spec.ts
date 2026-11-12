import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '@tripflix/auth';
import { InboxController, InboxQuerySchema } from './inbox.controller.js';
import { decodeInboxCursor, encodeInboxCursor, InboxRepository, type InboxRow } from './inbox.repository.js';

describe('Con trỏ hộp thư', () => {
  it('mã hoá base64url và giải mã đúng thời điểm cùng id, giữ microsecond', () => {
    const id = randomUUID();
    const time = '2026-11-12T12:00:00.123456Z';
    const cursor = encodeInboxCursor(time, id);
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))).toEqual([time, id]);
    expect(decodeInboxCursor(cursor)).toEqual([time, id]);
  });

  it.each([
    '',
    '%%%!',
    'e30',
    Buffer.from('["sai","id"]').toString('base64url'),
    Buffer.from('["2026-02-30T00:00:00Z","00000000-0000-4000-8000-000000000001"]').toString('base64url'),
  ])('từ chối con trỏ hỏng %s', (cursor) => {
    expect(() => decodeInboxCursor(cursor)).toThrow();
  });
});

describe('Tham số truy vấn hộp thư', () => {
  it('mặc định 20 và chấp nhận hai biên 1, 50', () => {
    expect(InboxQuerySchema.parse({})).toEqual({ limit: 20 });
    expect(InboxQuerySchema.parse({ limit: '1' }).limit).toBe(1);
    expect(InboxQuerySchema.parse({ limit: '50' }).limit).toBe(50);
    const cursor = encodeInboxCursor(new Date().toISOString(), randomUUID());
    expect(InboxQuerySchema.parse({ cursor }).cursor).toBe(cursor);
  });

  it.each(['0', '51', '-1', '1.5', '', 'abc', 'Infinity', ['2', '3'], 20])(
    'từ chối limit sai %s',
    (limit) => {
      expect(InboxQuerySchema.safeParse({ limit }).success).toBe(false);
    },
  );

  it('từ chối cursor rỗng, hỏng hoặc lặp', () => {
    for (const cursor of ['', 'abc', ['abc', 'def']]) {
      expect(InboxQuerySchema.safeParse({ cursor }).success).toBe(false);
    }
  });
});

describe('InboxController', () => {
  const user: AuthUser = { userId: randomUUID(), role: 'member', sid: randomUUID(), exp: 2_000_000_000 };

  function setup() {
    const inbox = new InboxRepository({} as ConstructorParameters<typeof InboxRepository>[0]);
    const list = vi.spyOn(inbox, 'listForUser').mockResolvedValue({ items: [], nextCursor: null });
    const count = vi.spyOn(inbox, 'countUnread').mockResolvedValue(2);
    const read = vi.spyOn(inbox, 'markRead').mockResolvedValue(true);
    const readAll = vi.spyOn(inbox, 'markAllRead').mockResolvedValue(2);
    return { controller: new InboxController(inbox), list, count, read, readAll };
  }

  it('trả DTO camelCase và ISO, dùng userId từ token', async () => {
    const { controller, list, count } = setup();
    const row: InboxRow = {
      id: randomUUID(),
      user_id: user.userId,
      type: 'booking.paid',
      title: 'Đặt chỗ thành công',
      body: 'Đã thanh toán',
      link: '/bookings',
      data: { orderId: randomUUID() },
      source_event_id: randomUUID(),
      created_at: new Date('2026-11-12T00:00:00Z'),
      read_at: null,
    };
    list.mockResolvedValue({ items: [row], nextCursor: 'trang-sau' });
    expect(await controller.list(user, {})).toEqual({
      items: [
        {
          id: row.id,
          type: row.type,
          title: row.title,
          body: row.body,
          link: row.link,
          data: row.data,
          createdAt: '2026-11-12T00:00:00.000Z',
          readAt: null,
        },
      ],
      unreadCount: 2,
      nextCursor: 'trang-sau',
    });
    expect(list).toHaveBeenCalledWith(user.userId, { limit: 20 });
    expect(count).toHaveBeenCalledWith(user.userId);
  });

  it('trả 400 trước khi query repository khi query sai', async () => {
    const { controller, list } = setup();
    await expect(controller.list(user, { limit: '51' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.list(user, { cursor: 'sai' })).rejects.toBeInstanceOf(BadRequestException);
    expect(list).not.toHaveBeenCalled();
  });

  it('đọc chỉ hàng của người gọi, trả 404 khi không thuộc người gọi', async () => {
    const { controller, read } = setup();
    const id = randomUUID();
    expect(await controller.markRead(user, id)).toEqual({ unreadCount: 2 });
    expect(read).toHaveBeenCalledWith(user.userId, id);
    read.mockResolvedValue(false);
    await expect(controller.markRead(user, id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(controller.markRead(user, 'sai')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('đọc tất cả theo người gọi và trả không còn chưa đọc', async () => {
    const { controller, readAll } = setup();
    expect(await controller.markAllRead(user)).toEqual({ unreadCount: 0 });
    expect(readAll).toHaveBeenCalledWith(user.userId);
  });
});
