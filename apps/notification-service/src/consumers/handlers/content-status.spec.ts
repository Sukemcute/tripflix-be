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
  it('thông báo tác giả lý do ẩn mà không tạo liên kết công khai', async () => {
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
        action: 'hide',
        reasonCode: 'HARASSMENT',
        isAutomatic: true,
      },
    };
    await handlers['content.moderation.decided.v1']!(event as never);
    expect(inbox.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: id,
        type: 'moderation.comment.hide',
        link: '/account/moderation',
        body: expect.stringContaining('Quấy rối'),
      }),
    );
  });
});
