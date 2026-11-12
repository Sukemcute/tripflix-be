import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { EventEnvelope } from '@tripflix/contracts';
import { startPostgres, type PostgresFixture } from '@tripflix/testing';
import pg from 'pg';
import { EventRouter, MemoryProcessedEvents } from '../consumers/event-router.js';
import { ReactionNotificationRepository } from '../grouping/reaction-notification.repository.js';
import { MemoryMailer } from '../outapp/mailer.js';
import { CommentNotificationRepository } from './comment-notification.repository.js';
import { InboxRepository } from './inbox.repository.js';
import { PostNotificationRepository } from './post-notification.repository.js';

const authorId = randomUUID();

function event(type: string, payload: EventEnvelope['payload'], minute: number): EventEnvelope {
  return {
    eventId: randomUUID(), type, version: 1, producer: 'core-api',
    occurredAt: new Date(Date.UTC(2026, 10, 12, 9, minute)).toISOString(), payload,
  };
}

function moderation(postId: string, status: 'hidden' | 'removed' | 'published', minute: number): EventEnvelope {
  const action = event(status === 'published' ? 'content.post.restored' : 'content.post.hidden', {
    postId, authorId, actionId: randomUUID(), reasonCode: 'SCAM',
    previousStatus: status === 'published' ? 'hidden' : 'published', postStatus: status,
  }, minute);
  action.payload.hiddenAt = action.occurredAt;
  return action;
}

function comment(postId: string, recipient: string, minute: number): EventEnvelope {
  const created = event('content.comment.created', {
    postId, postAuthorId: recipient, commentId: randomUUID(), authorId: randomUUID(),
    parentCommentId: null, body: 'Bình luận thử',
  }, minute);
  created.payload.createdAt = created.occurredAt;
  return created;
}

describe('Thông báo kiểm duyệt bài và video trên PostgreSQL', () => {
  let fixture: PostgresFixture;
  let pool: pg.Pool;
  let inbox: InboxRepository;
  let router: EventRouter;
  const emitToUser = vi.fn((_userId: string, _name: string, _payload: unknown) => true);

  beforeAll(async () => {
    fixture = await startPostgres();
    pool = new pg.Pool({ connectionString: fixture.buildModuleUrl('notification') });
    inbox = new InboxRepository(pool);
    await inbox.onModuleInit();
    router = new EventRouter(
      new MemoryMailer(), new MemoryProcessedEvents(), () => undefined, undefined,
      inbox, { emitToUser }, undefined, new CommentNotificationRepository(pool),
      new ReactionNotificationRepository(pool), new PostNotificationRepository(pool),
    );
  });

  afterAll(async () => {
    await pool?.end();
    await fixture?.stop();
  });

  it('ẩn tương tác đúng bài, báo lý do cho tác giả và chống ghi trùng', async () => {
    const postId = randomUUID();
    const recipient = randomUUID();
    await router.route(comment(postId, recipient, 0));
    await router.route(comment(randomUUID(), recipient, 0));
    const hidden = moderation(postId, 'hidden', 1);
    await Promise.all([router.route(hidden), router.route({ ...hidden, eventId: randomUUID() })]);
    await router.route(comment(postId, recipient, 2));

    const items = (await inbox.listForUser(authorId, { limit: 20 })).items.filter((row) => row.data.postId === postId);
    expect(items).toEqual([expect.objectContaining({
      type: 'moderation.post.hidden', body: 'Bài viết đã bị ẩn. Lý do: Lừa đảo.', link: null,
    })]);
    expect(await inbox.countUnread(recipient)).toBe(1);
    expect(emitToUser).toHaveBeenCalledWith(recipient, 'notification.read', { unreadCount: 1 });
  });

  it('gỡ và khôi phục bài, chỉ nhận tương tác mới sau khôi phục', async () => {
    const postId = randomUUID();
    const recipient = randomUUID();
    await Promise.all([router.route(comment(postId, recipient, 0)), router.route(moderation(postId, 'removed', 1))]);
    expect(await inbox.countUnread(recipient)).toBe(0);
    await router.route(moderation(postId, 'published', 3));
    await router.route(comment(postId, recipient, 2));
    await router.route(comment(postId, recipient, 4));
    expect(await inbox.countUnread(recipient)).toBe(1);
    const items = (await inbox.listForUser(authorId, { limit: 20 })).items.filter((row) => row.data.postId === postId);
    expect(items.map((row) => row.type)).toEqual(['moderation.post.restored', 'moderation.post.removed']);
  });

  it('lệnh ẩn giao muộn không che tương tác mới sau khôi phục', async () => {
    const postId = randomUUID();
    const recipient = randomUUID();
    await router.route(comment(postId, recipient, 0));
    await router.route(moderation(postId, 'published', 3));
    const newest = comment(postId, recipient, 4);
    await router.route(newest);
    await router.route(moderation(postId, 'hidden', 1));
    expect((await inbox.listForUser(recipient, { limit: 20 })).items).toEqual([
      expect.objectContaining({ source_event_id: newest.eventId }),
    ]);
  });

  it('ẩn nhóm cảm xúc đã có và giữ ẩn khi người cũ thích lại sau khôi phục', async () => {
    const postId = randomUUID();
    const actor = randomUUID();
    const reaction = (userId: string, type: string | null, minute: number) => event('content.reaction.updated', {
      postId, postAuthorId: authorId, userId, type, reactionTotal: type ? 1 : 0, reactionCounts: {},
    }, minute);
    await router.route(reaction(actor, 'like', 0));
    await router.route(reaction(actor, null, 1));
    await router.route(moderation(postId, 'hidden', 2));
    await router.route(reaction(randomUUID(), 'like', 3));
    await router.route(moderation(postId, 'published', 4));
    await router.route(reaction(actor, 'like', 5));
    const list = () => inbox.listForUser(authorId, { limit: 20, tab: 'interactions' });
    expect((await list()).items.filter((row) => row.data.postId === postId)).toEqual([]);
    await router.route(reaction(randomUUID(), 'like', 6));
    expect((await list()).items.filter((row) => row.data.postId === postId)).toEqual([
      expect.objectContaining({ type: 'reaction.post', data: { postId, actorCount: 1 } }),
    ]);
  });

  it('báo đúng người tải video, không đưa lý do kỹ thuật vào inbox và chống giao trùng', async () => {
    const ownerId = randomUUID();
    const ready = event('content.media.ready', { ownerId, assetId: randomUUID(), durationSec: 20 }, 0);
    const failed = event('content.media.failed', { ownerId, assetId: randomUUID(), reason: 'Chi tiết lỗi nội bộ' }, 1);
    await Promise.all([router.route(ready), router.route(failed), router.route(failed)]);
    const { items } = await inbox.listForUser(ownerId, { limit: 20 });
    expect(items).toHaveLength(2);
    expect(items).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'media.ready', data: { assetId: ready.payload.assetId } }),
      expect.objectContaining({ type: 'media.failed', data: { assetId: failed.payload.assetId } }),
    ]));
    expect(JSON.stringify(items)).not.toContain('Chi tiết lỗi nội bộ');
    expect(emitToUser.mock.calls.filter(([userId, name]) => userId === ownerId && name === 'notification.created')).toHaveLength(2);
  });
});
