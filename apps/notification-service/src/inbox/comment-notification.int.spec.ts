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
    commentId: randomUUID(),
    postId: randomUUID(),
    postAuthorId: randomUUID(),
    authorId: randomUUID(),
    parentCommentId: randomUUID(),
    parentCommentAuthorId: randomUUID(),
    body: 'Nội dung thử',
    createdAt,
    ...overrides,
  };
}

function event(type: string, payload: EventEnvelope['payload']): EventEnvelope {
  return { eventId: randomUUID(), type, version: 1, occurredAt: createdAt, producer: 'core-api', payload };
}

function deletion(payload: ContentCommentCreatedV1): EventEnvelope {
  const { commentId, postId, authorId, parentCommentId } = payload;
  return event('content.comment.deleted', {
    commentId,
    postId,
    authorId,
    parentCommentId,
    deletedBy: authorId,
    isSuperAdmin: false,
    deletedAt,
  });
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
      new MemoryMailer(),
      new MemoryProcessedEvents(),
      () => undefined,
      undefined,
      inbox,
      { emitToUser },
      undefined,
      new CommentNotificationRepository(pool),
    );
  });

  afterAll(async () => {
    await pool?.end();
    await fixture?.stop();
  });

  beforeEach(() => emitToUser.mockClear());

  it('ghi hai người nhận, lấy tên từ directory và chống ghi trùng khi xử lý đồng thời', async () => {
    const payload = comment();
    await pool.query('INSERT INTO user_directory (user_id, display_name) VALUES ($1, $2)', [
      payload.authorId,
      'Trang',
    ]);
    const created = event('content.comment.created', payload);
    await Promise.all([router.route(created), router.route(created)]);
    const postAuthor = await inbox.listForUser(payload.postAuthorId, { limit: 20, tab: 'interactions' });
    const parentAuthor = await inbox.listForUser(payload.parentCommentAuthorId!, { limit: 20 });
    expect(postAuthor.items).toEqual([
      expect.objectContaining({ type: 'comment.created', body: 'Trang đã bình luận bài của bạn.' }),
    ]);
    expect(parentAuthor.items).toEqual([
      expect.objectContaining({ type: 'comment.replied', body: 'Trang đã trả lời bình luận của bạn.' }),
    ]);
    expect(emitToUser.mock.calls).toHaveLength(2);
    expect(await inbox.countUnread(payload.authorId)).toBe(0);
  });

  it('hiện tên từ event khi directory chưa đồng bộ và lưu link tới lượt trả lời', async () => {
    const payload = comment({ authorDisplayName: 'Trang' });
    await router.route(event('content.comment.created', payload));
    const { items } = await inbox.listForUser(payload.parentCommentAuthorId!, { limit: 20 });
    expect(items).toEqual([
      expect.objectContaining({
        body: 'Trang đã trả lời bình luận của bạn.',
        link: `/trips/${payload.postId}?comment=${payload.commentId}`,
        data: {
          postId: payload.postId,
          commentId: payload.commentId,
          parentCommentId: payload.parentCommentId,
          excerpt: 'Nội dung thử',
        },
      }),
    ]);
  });

  it('báo cho tác giả lượt trả lời được nhắm tới và mở lượt trả lời mới', async () => {
    const replyToAuthorId = randomUUID();
    const payload = comment({
      authorDisplayName: 'Trang',
      replyToCommentId: randomUUID(),
      replyToAuthorId,
      postVisibility: 'public',
    });
    await router.route(event('content.comment.created', payload));
    const { items } = await inbox.listForUser(replyToAuthorId, { limit: 20 });
    expect(items).toEqual([
      expect.objectContaining({
        title: 'Trang đã trả lời bình luận',
        body: 'Trang đã trả lời bình luận của bạn.',
        link: `/trips/${payload.postId}?comment=${payload.commentId}`,
        data: expect.objectContaining({
          commentId: payload.commentId,
          parentCommentId: payload.parentCommentId,
        }),
      }),
    ]);
    // N2: tác giả bình luận gốc không được trả lời trực tiếp vẫn nhận dòng luồng, không nhận dòng trả lời.
    const rootAuthorItems = (await inbox.listForUser(payload.parentCommentAuthorId!, { limit: 20 })).items;
    expect(rootAuthorItems.map((item) => item.type)).toEqual(['comment.thread_replied']);
  });

  it('không gửi reply hay trích đoạn cho người khác khi bình luận được duyệt sau khi bài chuyển private', async () => {
    const payload = comment({
      postVisibility: 'private',
      replyToAuthorId: randomUUID(),
      replyToCommentId: randomUUID(),
      replyRecipientKnown: true,
    });
    await router.route(event('content.comment.created', payload));
    expect((await inbox.listForUser(payload.postAuthorId, { limit: 20 })).items).toHaveLength(1);
    expect((await inbox.listForUser(payload.replyToAuthorId!, { limit: 20 })).items).toHaveLength(0);
    expect((await inbox.listForUser(payload.parentCommentAuthorId!, { limit: 20 })).items).toHaveLength(0);
  });

  it('gộp hai vai trò của cùng một người và bỏ thông báo cho chính người bình luận', async () => {
    const userId = randomUUID();
    const payload = comment({ postAuthorId: userId, parentCommentAuthorId: userId });
    await router.route(event('content.comment.created', payload));
    expect((await inbox.listForUser(userId, { limit: 20 })).items).toEqual([
      expect.objectContaining({ type: 'comment.replied' }),
    ]);
    const self = comment({
      postAuthorId: userId,
      authorId: userId,
      parentCommentId: null,
      parentCommentAuthorId: null,
    });
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
    expect(
      (await pool.query('SELECT deleted_at FROM inbox WHERE id = $1', [row.id])).rows[0].deleted_at,
    ).toEqual(new Date(deletedAt));

    const late = comment();
    await router.route(deletion(late));
    await router.route(event('content.comment.created', late));
    expect(await inbox.countUnread(late.postAuthorId)).toBe(0);

    const concurrent = comment();
    await Promise.all([
      router.route(event('content.comment.created', concurrent)),
      router.route(deletion(concurrent)),
    ]);
    expect((await inbox.listForUser(concurrent.postAuthorId, { limit: 20 })).items).toEqual([]);
  });

  describe('N2: theo dõi luồng trả lời', () => {
    const postId = randomUUID();
    const postAuthorId = randomUUID();
    const [a, b, d, e] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    const rootId = randomUUID();

    function reply(
      authorId: string,
      replyToAuthorId: string,
      authorDisplayName: string,
    ): ContentCommentCreatedV1 {
      return comment({
        postId,
        postAuthorId,
        authorId,
        authorDisplayName,
        parentCommentId: rootId,
        parentCommentAuthorId: a,
        replyToCommentId: randomUUID(),
        replyToAuthorId,
        postVisibility: 'public',
      });
    }

    async function threadRows(userId: string) {
      const { items } = await inbox.listForUser(userId, { limit: 20 });
      return items.filter((item) => item.type === 'comment.thread_replied');
    }

    it('A bình luận, B trả lời A, D trả lời B: B nhận trả lời trực tiếp, A nhận dòng luồng, không ai nhận trùng', async () => {
      await router.route(
        event(
          'content.comment.created',
          comment({
            commentId: rootId,
            postId,
            postAuthorId,
            authorId: a,
            parentCommentId: null,
            parentCommentAuthorId: null,
            postVisibility: 'public',
          }),
        ),
      );
      await router.route(event('content.comment.created', reply(b, a, 'Bình')));
      emitToUser.mockClear();
      const fromD = reply(d, b, 'Dương');
      await router.route(event('content.comment.created', fromD));

      expect(await threadRows(a)).toEqual([
        expect.objectContaining({
          title: 'Có trả lời mới trong luồng',
          body: 'Dương đã trả lời trong luồng bạn tham gia.',
          link: `/trips/${postId}?comment=${fromD.commentId}`,
          data: {
            postId,
            commentId: fromD.commentId,
            parentCommentId: rootId,
            actorIds: [d],
            excerpt: 'Nội dung thử',
          },
        }),
      ]);
      expect((await inbox.listForUser(b, { limit: 20 })).items.map((item) => item.type)).toEqual([
        'comment.replied',
      ]);
      expect(await inbox.countUnread(d)).toBe(0);
      expect(await threadRows(postAuthorId)).toEqual([]);
      // A còn dòng 'comment.replied' khi B trả lời A.
      expect(emitToUser).toHaveBeenCalledWith(
        a,
        'notification.created',
        expect.objectContaining({ unreadCount: 2 }),
      );
    });

    it('gom vào dòng chưa đọc, đếm mỗi người một lần, gửi lại sự kiện không đổi gì', async () => {
      emitToUser.mockClear();
      const fromE = event('content.comment.created', reply(e, b, 'Em'));
      await Promise.all([router.route(fromE), router.route({ ...fromE, eventId: fromE.eventId })]);
      await router.route(event('content.comment.created', reply(d, e, 'Dương')));

      const rows = await threadRows(a);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        body: 'Dương và 1 người khác đã trả lời trong luồng bạn tham gia.',
        data: { actorIds: [d, e] },
      });
      expect(await inbox.countUnread(a)).toBe(2);
      expect(emitToUser).toHaveBeenCalledWith(a, 'notification.read', { unreadCount: 2 });
      // B đã trả lời trong luồng nên nhận dòng luồng khi D trả lời E.
      expect(await threadRows(b)).toEqual([
        expect.objectContaining({ body: 'Dương đã trả lời trong luồng bạn tham gia.' }),
      ]);
    });

    it('đọc rồi thì trả lời sau tạo dòng mới; xoá bình luận mới nhất thì ẩn dòng gom', async () => {
      const [read] = await threadRows(a);
      expect(await inbox.markRead(a, read!.id)).toBe(true);
      const latest = reply(b, d, 'Bình');
      await router.route(event('content.comment.created', latest));
      const rows = await threadRows(a);
      expect(rows).toHaveLength(2);
      expect(rows).toContainEqual(
        expect.objectContaining({ body: 'Bình đã trả lời trong luồng bạn tham gia.', read_at: null }),
      );

      await router.route(deletion(latest));
      expect(await threadRows(a)).toEqual([expect.objectContaining({ id: read!.id })]);
      expect(await inbox.countUnread(a)).toBe(1);
    });

    it('bài private hoặc sự kiện thiếu postVisibility thì không báo người trong luồng', async () => {
      const otherPost = randomUUID();
      const [root, x, y] = [randomUUID(), randomUUID(), randomUUID()];
      const base = { postId: otherPost, parentCommentId: root, parentCommentAuthorId: x };
      for (const postVisibility of ['private', undefined] as const) {
        await router.route(
          event(
            'content.comment.created',
            comment({ ...base, authorId: y, replyToAuthorId: x, postVisibility }),
          ),
        );
        await router.route(
          event(
            'content.comment.created',
            comment({ ...base, authorId: randomUUID(), replyToAuthorId: y, postVisibility }),
          ),
        );
      }
      expect(await threadRows(x)).toEqual([]);
      expect(
        (await pool.query('SELECT 1 FROM thread_participants WHERE parent_comment_id = $1', [root])).rowCount,
      ).toBe(0);
    });
  });

  describe('TF25: thông báo khi được tag trong bình luận', () => {
    async function mentionRows(userId: string) {
      return (await inbox.listForUser(userId, { limit: 20, tab: 'interactions' })).items.filter(
        (item) => item.type === 'comment.mentioned',
      );
    }

    function mention(overrides: Partial<ContentCommentCreatedV1> = {}) {
      return comment({
        parentCommentId: null,
        parentCommentAuthorId: null,
        authorDisplayName: 'Thành',
        postVisibility: 'public',
        ...overrides,
      });
    }

    it('đăng ngay: người được tag nhận "X đã nhắc đến bạn trong một bình luận"', async () => {
      const tagged = randomUUID();
      const payload = mention({ mentionedUserIds: [tagged] });
      await router.route(event('content.comment.created', payload));
      expect(await mentionRows(tagged)).toEqual([
        expect.objectContaining({
          title: 'Thành đã nhắc đến bạn',
          body: 'Thành đã nhắc đến bạn trong một bình luận.',
          link: `/trips/${payload.postId}?comment=${payload.commentId}`,
        }),
      ]);
      expect(emitToUser).toHaveBeenCalledWith(tagged, 'notification.created', expect.anything());
    });

    it('chủ bài duyệt: lúc giữ không báo, lúc duyệt mới báo', async () => {
      const tagged = randomUUID();
      const payload = mention({ mentionedUserIds: [tagged] });
      await router.route(event('content.comment.held', payload));
      expect(await mentionRows(tagged)).toEqual([]);
      await router.route(event('content.comment.created', payload));
      expect(await mentionRows(tagged)).toHaveLength(1);
    });

    it('nền tảng gỡ giữ sau hai lớp giữ: chỉ báo một lần khi bình luận công khai', async () => {
      const tagged = randomUUID();
      const payload = mention({ mentionedUserIds: [tagged] });
      // Bị giữ ở cả chủ bài và nền tảng; chủ bài duyệt xong vẫn còn giữ nên core chưa phát created.
      await router.route(event('content.comment.held', payload));
      await router.route(event('content.comment.held', payload));
      expect(await mentionRows(tagged)).toEqual([]);
      await router.route(event('content.comment.created', payload));
      expect(await mentionRows(tagged)).toHaveLength(1);
    });

    it('event lặp (cùng hoặc khác eventId) không tạo thông báo trùng', async () => {
      const tagged = randomUUID();
      const payload = mention({ mentionedUserIds: [tagged] });
      const created = event('content.comment.created', payload);
      await Promise.all([router.route(created), router.route(created)]);
      await router.route(event('content.comment.created', payload));
      expect(await mentionRows(tagged)).toHaveLength(1);
    });

    it('người đã nhận thông báo chủ bài hoặc trả lời cho cùng bình luận thì không nhận thêm thông báo tag', async () => {
      const postAuthorId = randomUUID();
      const parentCommentAuthorId = randomUUID();
      const payload = mention({
        postAuthorId,
        parentCommentId: randomUUID(),
        parentCommentAuthorId,
        mentionedUserIds: [postAuthorId, parentCommentAuthorId],
      });
      await router.route(event('content.comment.created', payload));
      await router.route(event('content.comment.created', payload));
      expect((await inbox.listForUser(postAuthorId, { limit: 20 })).items.map((item) => item.type)).toEqual([
        'comment.created',
      ]);
      expect((await inbox.listForUser(parentCommentAuthorId, { limit: 20 })).items.map((item) => item.type)).toEqual([
        'comment.replied',
      ]);
    });

    it('tự tag mình thì không báo', async () => {
      const authorId = randomUUID();
      await router.route(event('content.comment.created', mention({ authorId, mentionedUserIds: [authorId] })));
      expect(await inbox.countUnread(authorId)).toBe(0);
    });

    it('bài private hoặc thiếu postVisibility thì không báo người được tag', async () => {
      const tagged = randomUUID();
      for (const postVisibility of ['private', undefined] as const) {
        await router.route(event('content.comment.created', mention({ postVisibility, mentionedUserIds: [tagged] })));
      }
      expect(await inbox.countUnread(tagged)).toBe(0);
    });
  });
});
