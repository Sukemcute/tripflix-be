import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { ContentCommentCreatedV1, EventEnvelope } from '@tripflix/contracts';
import { startPostgres, type PostgresFixture } from '@tripflix/testing';
import pg from 'pg';
import { EventRouter, MemoryProcessedEvents } from '../consumers/event-router.js';
import { envSchema } from '../env.js';
import { MemoryMailer } from '../outapp/mailer.js';
import { CommentNotificationRepository } from './comment-notification.repository.js';
import { InboxRepository } from './inbox.repository.js';
import { POST_WATCH_PAGE_SIZE, POST_WATCH_TYPE, PostWatchWorker } from './post-watch.worker.js';

const occurredAt = '2026-11-16T09:00:00.000Z';

function event(type: string, payload: EventEnvelope['payload']): EventEnvelope {
  return { eventId: randomUUID(), type, version: 1, occurredAt, producer: 'core-api', payload };
}

describe('N1: theo dõi bài đã bình luận trên PostgreSQL', () => {
  let fixture: PostgresFixture;
  let pool: pg.Pool;
  let inbox: InboxRepository;
  let router: EventRouter;
  let worker: PostWatchWorker;

  beforeAll(async () => {
    fixture = await startPostgres();
    const url = fixture.buildModuleUrl('notification');
    pool = new pg.Pool({ connectionString: url });
    inbox = new InboxRepository(pool);
    await inbox.onModuleInit();
    router = new EventRouter(
      new MemoryMailer(), new MemoryProcessedEvents(), () => undefined,
      undefined, inbox, { emitToUser: () => true }, undefined, new CommentNotificationRepository(pool),
    );
    worker = new PostWatchWorker(pool, envSchema.parse({ DATABASE_URL_NOTIFICATION: url }));
  });

  afterAll(async () => {
    await pool?.end();
    await fixture?.stop();
  });

  function post() {
    const postId = randomUUID();
    const postAuthorId = randomUUID();
    const root = (authorId: string, authorDisplayName: string): ContentCommentCreatedV1 => ({
      commentId: randomUUID(), postId, postAuthorId, authorId, authorDisplayName, parentCommentId: null,
      parentCommentAuthorId: null, body: 'Bình luận thử', createdAt: occurredAt,
    });
    const reply = (authorId: string, parent: ContentCommentCreatedV1): ContentCommentCreatedV1 => ({
      ...root(authorId, 'Người trả lời'), parentCommentId: parent.commentId, parentCommentAuthorId: parent.authorId,
      replyToCommentId: parent.commentId, replyToAuthorId: parent.authorId,
    });
    return { postId, postAuthorId, root, reply };
  }

  async function drain() {
    while (await worker.runOnce()) { /* chạy hết các lô đang chờ */ }
  }

  async function watchRows(userId: string) {
    const { items } = await inbox.listForUser(userId, { limit: 50 });
    return items.filter((item) => item.type === POST_WATCH_TYPE);
  }

  it('báo bình luận gốc mới cho người từng bình luận, trừ chủ bài và người viết', async () => {
    const { postId, postAuthorId, root, reply } = post();
    const [a, b, c] = [randomUUID(), randomUUID(), randomUUID()];
    const fromA = root(a, 'An');
    await router.route(event('content.comment.created', fromA));
    await router.route(event('content.comment.created', reply(b, fromA)));
    await router.route(event('content.comment.created', root(postAuthorId, 'Chủ bài')));
    await drain();
    const fromC = root(c, 'Chi');
    await router.route(event('content.comment.created', fromC));
    await drain();

    // Job chạy sau khi B đã trả lời nên B nhận cả bình luận gốc của A; mọi bình luận gốc gom vào một dòng chưa đọc.
    const expected = { a: [postAuthorId, c], b: [a, postAuthorId, c] };
    for (const [watcher, actorIds] of [[a, expected.a], [b, expected.b]] as const) {
      expect(await watchRows(watcher)).toEqual([expect.objectContaining({
        title: 'Có bình luận mới ở bài bạn theo dõi',
        body: `Chi và ${actorIds.length - 1} người khác đã bình luận bài bạn theo dõi.`,
        link: `/trips/${postId}?comment=${fromC.commentId}`,
        data: { postId, commentId: fromC.commentId, actorIds },
      })]);
    }
    expect(await watchRows(c)).toEqual([]);
    expect(await watchRows(postAuthorId)).toEqual([]);
    // 3 bình luận gốc (A, chủ bài, C) tạo 3 job; trả lời của B không tạo job vì N2 đã báo người trong luồng.
    expect((await pool.query('SELECT count(*)::int AS n FROM post_watch_jobs WHERE post_id = $1', [postId])).rows[0].n).toBe(3);
  });

  it('gom mỗi người một lần khi chưa đọc, đọc rồi thì tạo dòng mới', async () => {
    const { root } = post();
    const [a, d] = [randomUUID(), randomUUID()];
    await router.route(event('content.comment.created', root(a, 'An')));
    await router.route(event('content.comment.created', root(d, 'Dũng')));
    await router.route(event('content.comment.created', root(d, 'Dũng')));
    await drain();
    const [row] = await watchRows(a);
    expect(row).toMatchObject({ body: 'Dũng đã bình luận bài bạn theo dõi.', data: expect.objectContaining({ actorIds: [d] }) });
    expect(await inbox.countUnread(a)).toBe(1);

    expect(await inbox.markRead(a, row!.id)).toBe(true);
    await router.route(event('content.comment.created', root(d, 'Dũng')));
    await drain();
    expect(await watchRows(a)).toHaveLength(2);
    expect(await inbox.countUnread(a)).toBe(1);
  });

  it('tắt theo dõi thì không nhận, bình luận lại vẫn giữ trạng thái tắt; chưa bình luận thì không đổi được', async () => {
    const { postId, root } = post();
    const [a, b, stranger] = [randomUUID(), randomUUID(), randomUUID()];
    await router.route(event('content.comment.created', root(a, 'An')));
    expect(await worker.getWatching(a, postId)).toBe(true);
    expect(await worker.setWatching(a, postId, false)).toBe(true);
    await router.route(event('content.comment.created', root(a, 'An')));
    expect(await worker.getWatching(a, postId)).toBe(false);
    await router.route(event('content.comment.created', root(b, 'Bình')));
    await drain();
    expect(await watchRows(a)).toEqual([]);

    expect(await worker.getWatching(stranger, postId)).toBeNull();
    expect(await worker.setWatching(stranger, postId, true)).toBe(false);
  });

  it('xoá bình luận trước khi job chạy thì huỷ job, không ai nhận', async () => {
    const { postId, root } = post();
    const a = randomUUID();
    await router.route(event('content.comment.created', root(a, 'An')));
    await drain();
    const removed = root(randomUUID(), 'Bị xoá');
    await router.route(event('content.comment.created', removed));
    await router.route(event('content.comment.deleted', {
      commentId: removed.commentId, postId, authorId: removed.authorId, parentCommentId: null,
      deletedBy: removed.authorId, isSuperAdmin: false, deletedAt: occurredAt,
    }));
    await drain();
    expect(await watchRows(a)).toEqual([]);
    expect((await pool.query('SELECT state FROM post_watch_jobs WHERE comment_id = $1', [removed.commentId])).rows[0].state)
      .toBe('cancelled');
  });

  it('bài đông người chia lô theo user_id, ai cũng nhận đúng một dòng', async () => {
    const { postId, root } = post();
    const watcherCount = POST_WATCH_PAGE_SIZE * 2 + 50;
    const watchers = Array.from({ length: watcherCount }, () => randomUUID());
    await pool.query(
      'INSERT INTO post_watchers (post_id, user_id, changed_at) SELECT $1, unnest($2::uuid[]), now()', [postId, watchers],
    );
    const fromE = root(randomUUID(), 'Em');
    await router.route(event('content.comment.created', fromE));
    let rounds = 0;
    while (await worker.runOnce()) rounds += 1;
    expect(rounds).toBe(3);
    const { rows } = await pool.query<{ n: number; users: number }>(
      'SELECT count(*)::int AS n, count(DISTINCT user_id)::int AS users FROM inbox WHERE type = $1 AND comment_id = $2',
      [POST_WATCH_TYPE, fromE.commentId],
    );
    expect(rows[0]).toEqual({ n: watcherCount, users: watcherCount });
    expect((await pool.query('SELECT state FROM post_watch_jobs WHERE comment_id = $1', [fromE.commentId])).rows[0].state).toBe('done');
  });
});
