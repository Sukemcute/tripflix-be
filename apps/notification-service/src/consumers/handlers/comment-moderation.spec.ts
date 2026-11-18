import { expect, it, vi } from 'vitest';
import { createCommentHandlers } from './comment.js';

it('không đoán người nhận reply từ tác giả gốc khi sự kiện xác nhận không biết đích cũ', async () => {
  const owner = '11111111-1111-4111-8111-111111111111';
  const rootAuthor = '22222222-2222-4222-8222-222222222222';
  const writer = '33333333-3333-4333-8333-333333333333';
  const comments = { create: vi.fn().mockResolvedValue([]), hide: vi.fn() };
  const handlers = createCommentHandlers({ comments, inbox: undefined, realtime: undefined, log: vi.fn() });
  await handlers['content.comment.created.v1']!({
    payload: {
      commentId: writer,
      postId: owner,
      postAuthorId: owner,
      authorId: writer,
      parentCommentId: rootAuthor,
      parentCommentAuthorId: rootAuthor,
      replyRecipientKnown: false,
      body: 'Phản hồi cũ',
      createdAt: '2026-11-18T00:00:00.000Z',
      postVisibility: 'public',
    },
  } as never);
  expect(comments.create).toHaveBeenCalledWith(
    expect.objectContaining({ recipients: [{ userId: owner, isReplyRecipient: false }] }),
  );
});

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
