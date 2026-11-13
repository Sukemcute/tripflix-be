import { expect, it, vi } from 'vitest';
import { createCommentHandlers } from './comment.js';

it('tạm ẩn bình luận thu hồi thông báo tương tác kể cả sự kiện tạo đến muộn', async () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const comments = { create: vi.fn(), hide: vi.fn().mockResolvedValue([id]) };
  const realtime = { emitToUser: vi.fn() };
  const handlers = createCommentHandlers({
    comments,
    realtime,
    inbox: { countUnread: vi.fn().mockResolvedValue(0) },
    log: vi.fn(),
  });
  const occurredAt = '2026-11-13T00:00:00.000Z';
  await handlers['content.comment.hidden.v1']!({
    occurredAt,
    payload: { postId: id, commentId: id, authorId: id },
  } as never);
  expect(comments.hide).toHaveBeenCalledWith(id, occurredAt);
  expect(realtime.emitToUser).toHaveBeenCalledWith(id, 'notification.read', { unreadCount: 0 });
});
