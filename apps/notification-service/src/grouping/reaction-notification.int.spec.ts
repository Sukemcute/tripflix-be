import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { EventEnvelope } from '@tripflix/contracts';
import { startPostgres, type PostgresFixture } from '@tripflix/testing';
import pg from 'pg';
import { EventRouter, MemoryProcessedEvents } from '../consumers/event-router.js';
import { CommentNotificationRepository } from '../inbox/comment-notification.repository.js';
import { InboxRepository } from '../inbox/inbox.repository.js';
import { MemoryMailer } from '../outapp/mailer.js';
import { ReactionNotificationRepository } from './reaction-notification.repository.js';

const baseTime = Date.parse('2026-11-12T09:00:00.000Z');

function postReaction(postId: string, postAuthorId: string, userId: string, type: string | null, offset = 0): EventEnvelope {
  return {
    eventId: randomUUID(), type: 'content.reaction.updated', version: 1,
    occurredAt: new Date(baseTime + offset).toISOString(), producer: 'core-api',
    payload: { postId, postAuthorId, userId, type, reactionTotal: 1, reactionCounts: { like: 1 } },
  };
}

describe('Gom thông báo cảm xúc trên PostgreSQL', () => {
  let fixture: PostgresFixture;
  let pool: pg.Pool;
  let inbox: InboxRepository;
  let router: EventRouter;
  const emitToUser = vi.fn((_userId: string, _name: string, _data: unknown) => true);

  beforeAll(async () => {
    fixture = await startPostgres();
    pool = new pg.Pool({ connectionString: fixture.buildModuleUrl('notification') });
    inbox = new InboxRepository(pool);
    await inbox.onModuleInit();
    router = new EventRouter(
      new MemoryMailer(), new MemoryProcessedEvents(), () => undefined,
      undefined, inbox, { emitToUser }, undefined,
      new CommentNotificationRepository(pool), new ReactionNotificationRepository(pool),
    );
  });

  afterAll(async () => {
    await pool?.end();
    await fixture?.stop();
  });

  beforeEach(() => emitToUser.mockClear());

  it('gom 20 người đồng thời thành một thông báo và bỏ lần phát lại', async () => {
    const postId = randomUUID();
    const owner = randomUUID();
    const events = Array.from({ length: 20 }, (_, i) => postReaction(postId, owner, randomUUID(), 'like', i * 1000));
    await Promise.all([...events, events[0]!].map((event) => router.route(event)));
    const { items } = await inbox.listForUser(owner, { limit: 20, tab: 'interactions' });
    expect(items).toEqual([expect.objectContaining({ type: 'reaction.post', data: { postId, actorCount: 20 } })]);
    expect(await inbox.countUnread(owner)).toBe(1);
    expect(emitToUser.mock.calls.filter(([, name]) => name === 'notification.created')).toHaveLength(1);
  });

  it('bỏ tự thích, cập nhật số đang thích và không báo lại khi đổi hoặc thích lại qua cửa sổ', async () => {
    const postId = randomUUID();
    const owner = randomUUID();
    const actor = randomUUID();
    await router.route(postReaction(postId, owner, owner, 'like'));
    expect(await inbox.countUnread(owner)).toBe(0);
    await router.route(postReaction(postId, owner, actor, 'like'));
    const first = (await inbox.listForUser(owner, { limit: 20 })).items[0]!;
    await router.route(postReaction(postId, owner, actor, 'love', 1000));
    expect((await inbox.listForUser(owner, { limit: 20 })).items[0]?.data.actorCount).toBe(1);
    await router.route(postReaction(postId, owner, actor, null, 3000));
    await router.route(postReaction(postId, owner, actor, 'like', 2000));
    expect((await inbox.listForUser(owner, { limit: 20 })).items).toEqual([]);
    await router.route(postReaction(postId, owner, actor, 'like', 125_000));
    expect((await inbox.listForUser(owner, { limit: 20 })).items).toEqual([
      expect.objectContaining({ id: first.id, data: { postId, actorCount: 1 }, read_at: expect.any(Date) }),
    ]);
    expect(await inbox.countUnread(owner)).toBe(0);
    expect(emitToUser.mock.calls.filter(([, name]) => name === 'notification.created')).toHaveLength(1);
  });

  it('mở nhóm mới cho người khác sau khi nhóm trước đã đọc, hoặc khi sang cửa sổ mới', async () => {
    const postId = randomUUID();
    const owner = randomUUID();
    await router.route(postReaction(postId, owner, randomUUID(), 'like'));
    await inbox.markAllRead(owner);
    await router.route(postReaction(postId, owner, randomUUID(), 'like', 1000));
    await router.route(postReaction(postId, owner, randomUUID(), 'like', 120_000));
    expect((await inbox.listForUser(owner, { limit: 20 })).items).toHaveLength(3);
    expect(await inbox.countUnread(owner)).toBe(2);
  });

  it('thông báo cho tác giả bình luận và không khôi phục nhóm khi bình luận bị xóa', async () => {
    const postId = randomUUID();
    const commentId = randomUUID();
    const commentAuthorId = randomUUID();
    const userId = randomUUID();
    const payload = { postId, commentId, commentAuthorId, userId, isLiked: true, likeCount: 1 };
    const event = {
      eventId: randomUUID(), type: 'content.comment_reaction.updated', version: 1,
      occurredAt: new Date(baseTime).toISOString(), producer: 'core-api', payload,
    };
    await router.route(event);
    expect((await inbox.listForUser(commentAuthorId, { limit: 20 })).items).toEqual([
      expect.objectContaining({ type: 'reaction.comment', data: { postId, commentId, actorCount: 1 } }),
    ]);
    await new CommentNotificationRepository(pool).hide(commentId, new Date(baseTime + 1000).toISOString());
    await router.route({ ...event, eventId: randomUUID(), payload: { ...payload, userId: randomUUID() } });
    expect(await inbox.countUnread(commentAuthorId)).toBe(0);
    expect((await inbox.listForUser(commentAuthorId, { limit: 20 })).items).toEqual([]);
  });

  it('dùng post_directory cho sự kiện cũ thiếu tác giả', async () => {
    const postId = randomUUID();
    const owner = randomUUID();
    const legacy = postReaction(postId, owner, randomUUID(), 'like');
    delete legacy.payload.postAuthorId;
    await pool.query('INSERT INTO post_directory (post_id, author_id) VALUES ($1, $2)', [postId, owner]);
    await router.route(legacy);
    expect(await inbox.countUnread(owner)).toBe(1);
  });
});
