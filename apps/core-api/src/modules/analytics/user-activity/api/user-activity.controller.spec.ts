import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import type { UserActivityQueries } from '../application/user-activity-queries.use-cases.js';
import { UserActivityController } from './user-activity.controller.js';

const userId = '11111111-1111-4111-8111-111111111111';
const at = new Date('2026-11-18T10:20:00.000Z');
const counts = { reactions: 1, comments: 2, shares: 0, views: 3, chats: 4 };

function controllerWith(queries: Partial<UserActivityQueries>) {
  return new UserActivityController(queries as UserActivityQueries);
}

describe('UserActivityController', () => {
  it('danh sách trả ngày dạng ISO; người chưa có hoạt động cuối thì null', async () => {
    const controller = controllerWith({
      list: async () => ({
        total: 2,
        items: [
          { userId, displayName: 'An', email: 'an@example.com', ...counts, lastActiveAt: at },
          { userId, displayName: null, email: null, ...counts, lastActiveAt: null },
        ],
      }),
    });

    const response = await controller.list({ from: '2026-11-12', to: '2026-11-18' });

    expect(response).toMatchObject({ page: 1, pageSize: 20, total: 2 });
    expect(response.items[0]).toMatchObject({ email: 'an@example.com', lastActiveAt: '2026-11-18T10:20:00.000Z' });
    expect(response.items[1]).toMatchObject({ displayName: null, lastActiveAt: null });
  });

  it('chi tiết đổi ngày đăng ký và thời điểm sự kiện sang ISO', async () => {
    const controller = controllerWith({
      detail: async () => ({
        userId,
        displayName: 'An',
        email: 'an@example.com',
        createdAt: new Date('2026-10-01T03:00:00.000Z'),
        counts: { ...counts, lastActiveAt: at },
        recentEvents: [{ id: userId, kind: 'chat', occurredAt: at, targetId: null, detail: { question: 'tour Huế' } }],
      }),
    });

    const response = await controller.detail(userId, {});

    expect(response.createdAt).toBe('2026-10-01T03:00:00.000Z');
    expect(response.counts.lastActiveAt).toBe('2026-11-18T10:20:00.000Z');
    expect(response.recentEvents[0]).toMatchObject({ occurredAt: '2026-11-18T10:20:00.000Z', detail: { question: 'tour Huế' } });
  });

  it('không có người dùng thì 404, userId sai dạng thì 400', async () => {
    const controller = controllerWith({ detail: async () => null });

    await expect(controller.detail(userId, {})).rejects.toBeInstanceOf(NotFoundException);
    await expect(controller.detail('khong-phai-uuid', {})).rejects.toBeInstanceOf(BadRequestException);
  });

  it('khoảng quá 90 ngày thì 400', async () => {
    const controller = controllerWith({ list: async () => ({ total: 0, items: [] }) });

    await expect(controller.list({ from: '2026-01-01', to: '2026-11-18' })).rejects.toBeInstanceOf(BadRequestException);
  });
});
