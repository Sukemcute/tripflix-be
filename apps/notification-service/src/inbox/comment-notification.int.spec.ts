import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { ContentCommentCreatedV1, EventEnvelope } from '@tripflix/contracts';
import { startPostgres, type PostgresFixture } from '@tripflix/testing';
import pg from 'pg';
import { EventRouter, MemoryProcessedEvents } from '../consumers/event-router.js';
import { MemoryMailer } from '../outapp/mailer.js';
import { CommentNotificationRepository } from './comment-notification.repository.js';
import { InboxRepository } from './inbox.repository.js';

const createdAt = '2026-11-12T09:00:00.000Z';
const deletedAt = '2026-11-12T09:01:00.000Z';

function comment(overrides: Partial<ContentCommentCreatedV1> = {}): ContentCommentCreatedV1 {
  return {
    commentId: randomUUID(), postId: randomUUID(), postAuthorId: randomUUID(),
    authorId: randomUUID(), parentCommentId: randomUUID(), parentCommentAuthorId: randomUUID(),
    body: 'Nội dung thử', createdAt, ...overrides,
  };
}

function event(type: string, payload: EventEnvelope['payload']): EventEnvelope {
  return { eventId: randomUUID(), type, version: 1, occurredAt: createdAt, producer: 'core-api', payload };
}

function deletion(payload: ContentCommentCreatedV1): EventEnvelope {
  const { commentId, postId, authorId, parentCommentId } = payload;
  return event('content.comment.deleted', { commentId, postId, authorId, parentCommentId, deletedBy: authorId, isSuperAdmin: false, deletedAt });
}

describe('Thông báo bình luận trên PostgreSQL', () => {
  let fixture: PostgresFixture;
  let pool: pg.Pool;
  let inbox: InboxRepository;
  let router: EventRouter;
  const emitToUser = vi.fn(() => true);

  beforeAll(async () => {
    fixture = await startPostgres();
    pool = new pg.Pool({ connectionString: fixture.buildModuleUrl('notification') });
    inbox = new InboxRepository(pool);
    await inbox.onModuleInit();
    router = new EventRouter(
      new MemoryMailer(), new MemoryProcessedEvents(), () => undefined,
      undefined, inbox, { emitToUser }, undefined, new CommentNotificationRepository(pool),
    );
  });

  afterAll(async () => {
    await pool?.end();
    await fixture?.stop();
  });

  beforeEach(() => emitToUser.mockClear());

  it('ghi hai người nhận, lấy tên từ directory và chống ghi trùng khi xử lý đồng thời', async () => {
    const payload = comment();
    await pool.query('INSERT INTO user_directory (user_id, display_name) VALUES ($1, $2)', [payload.authorId, 'Trang']);
    const created = event('content.comment.created', payload);
    await Promise.all([router.route(created), router.route(created)]);
    const postAuthor = await inbox.listForUser(payload.postAuthorId, { limit: 20, tab: 'interactions' });
    const parentAuthor = await inbox.listForUser(payload.parentCommentAuthorId!, { limit: 20 });
    expect(postAuthor.items).toEqual([expect.objectContaining({ type: 'comment.created', body: 'Trang đã bình luận bài của bạn.' })]);
    expect(parentAuthor.items).toEqual([expect.objectContaining({ type: 'comment.replied', body: 'Trang đã trả lời bình luận của bạn.' })]);
    expect(emitToUser.mock.calls).toHaveLength(2);
    expect(await inbox.countUnread(payload.authorId)).toBe(0);
  });

  it('hiện tên từ event khi directory chưa đồng bộ và lưu link tới lượt trả lời', async () => {
    const payload = comment({ authorDisplayName: 'Trang' });
    await router.route(event('content.comment.created', payload));
    const { items } = await inbox.listForUser(payload.parentCommentAuthorId!, { limit: 20 });
    expect(items).toEqual([expect.objectContaining({
      body: 'Trang đã trả lời bình luận của bạn.',
      link: `/trips/${payload.postId}?comment=${payload.commentId}`,
      data: { postId: payload.postId, commentId: payload.commentId, parentCommentId: payload.parentCommentId },
    })]);
  });

  it('báo cho tác giả lượt trả lời được nhắm tới và mở lượt trả lời mới', async () => {
    const replyToAuthorId = randomUUID();
    const payload = comment({ authorDisplayName: 'Trang', replyToCommentId: randomUUID(), replyToAuthorId });
    await router.route(event('content.comment.created', payload));
    const { items } = await inbox.listForUser(replyToAuthorId, { limit: 20 });
    expect(items).toEqual([expect.objectContaining({
      title: 'Trang đã trả lời bình luận',
      body: 'Trang đã trả lời bình luận của bạn.',
      link: `/trips/${payload.postId}?comment=${payload.commentId}`,
      data: expect.objectContaining({ commentId: payload.commentId, parentCommentId: payload.parentCommentId }),
    })]);
    expect(await inbox.countUnread(payload.parentCommentAuthorId!)).toBe(0);
  });

  it('gộp hai vai trò của cùng một người và bỏ thông báo cho chính người bình luận', async () => {
    const userId = randomUUID();
    const payload = comment({ postAuthorId: userId, parentCommentAuthorId: userId });
    await router.route(event('content.comment.created', payload));
    expect((await inbox.listForUser(userId, { limit: 20 })).items).toEqual([expect.objectContaining({ type: 'comment.replied' })]);
    const self = comment({ postAuthorId: userId, authorId: userId, parentCommentId: null, parentCommentAuthorId: null });
    await router.route(event('content.comment.created', self));
    expect(await inbox.countUnread(userId)).toBe(1);
  });

  it('giữ tương thích với reply cũ thiếu ID người viết bình luận cha', async () => {
    const { parentCommentAuthorId, ...legacy } = comment();
    await router.route(event('content.comment.created', legacy));
    expect(await inbox.countUnread(legacy.postAuthorId)).toBe(1);
    expect(await inbox.countUnread(parentCommentAuthorId!)).toBe(0);
  });

  it('ẩn thông báo, cập nhật số chưa đọc và không làm hiện lại khi xóa tới trước hoặc đồng thời', async () => {
    const payload = comment();
    await router.route(event('content.comment.created', payload));
    const row = (await inbox.listForUser(payload.postAuthorId, { limit: 20 })).items[0]!;
    await router.route(deletion(payload));
    expect(await inbox.countUnread(payload.postAuthorId)).toBe(0);
    expect(await inbox.countUnread(payload.parentCommentAuthorId!)).toBe(0);
    expect(await inbox.markRead(payload.postAuthorId, row.id)).toBe(false);
    expect(emitToUser).toHaveBeenCalledWith(payload.postAuthorId, 'notification.read', { unreadCount: 0 });
    expect((await pool.query('SELECT deleted_at FROM inbox WHERE id = $1', [row.id])).rows[0].deleted_at).toEqual(new Date(deletedAt));

    const late = comment();
    await router.route(deletion(late));
    await router.route(event('content.comment.created', late));
    expect(await inbox.countUnread(late.postAuthorId)).toBe(0);

    const concurrent = comment();
    await Promise.all([router.route(event('content.comment.created', concurrent)), router.route(deletion(concurrent))]);
    expect((await inbox.listForUser(concurrent.postAuthorId, { limit: 20 })).items).toEqual([]);
  });
});
