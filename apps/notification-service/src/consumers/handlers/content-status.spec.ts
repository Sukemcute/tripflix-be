import { describe, expect, it, vi } from 'vitest';
import { createContentStatusHandlers } from './content-status.js';

describe('comment moderation notifications', () => {
  it('thông báo quyết định bình luận trực tiếp kèm mã quyết định', async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const inbox = { insert: vi.fn().mockResolvedValue(null), countUnread: vi.fn() };
    const handlers = createContentStatusHandlers({ inbox, log: vi.fn() });
    await handlers['content.comment.moderation_action.v1']!({
      eventId: id,
      payload: {
        actionId: id,
        postId: id,
        commentId: id,
        authorId: id,
        action: 'remove',
        reasonCode: 'SCAM',
      },
    } as never);
    expect(inbox.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: id,
        link: '/account/moderation',
        data: expect.objectContaining({ decisionId: id }),
      }),
    );
  });
  it('không thông báo khôi phục trực tiếp nếu lần ẩn trước do hệ thống tự động', async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const inbox = { insert: vi.fn().mockResolvedValue({ user_id: id }), countUnread: vi.fn().mockResolvedValue(1) };
    const realtime = { emitToUser: vi.fn() };
    const handlers = createContentStatusHandlers({ inbox, realtime, log: vi.fn() });
    const handled = await handlers['content.comment.moderation_action.v1']!({
      eventId: id,
      payload: {
        actionId: id,
        postId: id,
        commentId: id,
        authorId: id,
        action: 'restore',
        reasonCode: 'HARASSMENT',
        previouslyAutoHidden: true,
      },
    } as never);

    expect(handled).toBe(true);
    expect(inbox.insert).not.toHaveBeenCalled();
    expect(inbox.countUnread).not.toHaveBeenCalled();
    expect(realtime.emitToUser).not.toHaveBeenCalled();
  });
  it('gửi kết quả khiếu nại và đường dẫn tới trạng thái kiểm duyệt', async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const inbox = { insert: vi.fn().mockResolvedValue(null), countUnread: vi.fn() };
    const handlers = createContentStatusHandlers({ inbox, log: vi.fn() });
    await handlers['content.appeal.decided.v1']!({
      eventId: id,
      payload: {
        appealId: id,
        decisionId: id,
        authorId: id,
        outcome: 'overturned',
      },
    } as never);
    expect(inbox.insert).toHaveBeenCalledWith(
      expect.objectContaining({ userId: id, link: '/account/moderation', type: 'moderation.appeal.decided' }),
    );
  });
  it.each([
    { action: 'hide', isAutomatic: false },
    { action: 'remove', isAutomatic: false },
    { action: 'restore', isAutomatic: false },
    { action: 'remove', isAutomatic: true },
    { action: 'restore', isAutomatic: true },
  ])('vẫn thông báo khi action=$action, isAutomatic=$isAutomatic', async ({ action, isAutomatic }) => {
    const id = '11111111-1111-4111-8111-111111111111';
    const inbox = { insert: vi.fn().mockResolvedValue(null), countUnread: vi.fn() };
    const handlers = createContentStatusHandlers({ inbox, log: vi.fn() });
    const event = {
      eventId: id,
      payload: {
        caseId: id,
        targetType: 'comment',
        targetId: id,
        postId: id,
        authorId: id,
        action,
        reasonCode: 'HARASSMENT',
        isAutomatic,
      },
    };
    await handlers['content.moderation.decided.v1']!(event as never);
    expect(inbox.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: id,
        type: `moderation.comment.${action}`,
        link: action === 'restore' ? `/trips/${id}` : '/account/moderation',
        body: action === 'restore'
          ? 'Bình luận của bạn đã hiển thị trở lại.'
          : expect.stringContaining('Quấy rối'),
      }),
    );
  });
  it('tự ẩn bình luận: xử lý thành công nhưng không tạo inbox hay phát notification.created', async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const inbox = { insert: vi.fn().mockResolvedValue({ user_id: id }), countUnread: vi.fn().mockResolvedValue(1) };
    const realtime = { emitToUser: vi.fn() };
    const handlers = createContentStatusHandlers({ inbox, realtime, log: vi.fn() });

    const handled = await handlers['content.moderation.decided.v1']!({
      eventId: id,
      payload: {
        caseId: id,
        targetType: 'comment',
        targetId: id,
        postId: id,
        authorId: id,
        action: 'hide',
        reasonCode: 'HARASSMENT',
        isAutomatic: true,
      },
    } as never);

    expect(handled).toBe(true);
    expect(inbox.insert).not.toHaveBeenCalled();
    expect(inbox.countUnread).not.toHaveBeenCalled();
    expect(realtime.emitToUser).not.toHaveBeenCalled();
  });
  it('không thông báo khôi phục qua moderation case nếu trước đó tự ẩn', async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const inbox = { insert: vi.fn().mockResolvedValue({ user_id: id }), countUnread: vi.fn().mockResolvedValue(1) };
    const realtime = { emitToUser: vi.fn() };
    const handlers = createContentStatusHandlers({ inbox, realtime, log: vi.fn() });
    const handled = await handlers['content.moderation.decided.v1']!({
      eventId: id,
      payload: {
        caseId: id,
        targetType: 'comment',
        targetId: id,
        postId: id,
        authorId: id,
        action: 'restore',
        reasonCode: 'HARASSMENT',
        isAutomatic: false,
        previouslyAutoHidden: true,
      },
    } as never);

    expect(handled).toBe(true);
    expect(inbox.insert).not.toHaveBeenCalled();
    expect(inbox.countUnread).not.toHaveBeenCalled();
    expect(realtime.emitToUser).not.toHaveBeenCalled();
  });
});
