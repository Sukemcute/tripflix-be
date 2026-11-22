import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { EventEnvelope } from '@tripflix/contracts';
import { startPostgres, type PostgresFixture } from '@tripflix/testing';
import pg from 'pg';
import { EventRouter, MemoryProcessedEvents } from '../consumers/event-router.js';
import { ensureInboxSchema } from '../inbox/inbox.schema.js';
import { MemoryMailer } from '../outapp/mailer.js';
import { DirectoryRepository } from './directory.repository.js';

const older = '2026-11-12T08:00:00.000Z';
const newer = '2026-11-12T09:00:00.000Z';

function event(type: string, occurredAt: string, payload: EventEnvelope['payload']): EventEnvelope {
  return { eventId: randomUUID(), type, version: 1, occurredAt, producer: 'core-api', payload };
}

describe('Directory của Notification trên PostgreSQL', () => {
  let fixture: PostgresFixture;
  let pool: pg.Pool;
  let router: EventRouter;
  const mailer = new MemoryMailer();

  beforeAll(async () => {
    fixture = await startPostgres();
    pool = new pg.Pool({ connectionString: fixture.buildModuleUrl('notification') });
    await ensureInboxSchema(pool);
    router = new EventRouter(
      mailer, new MemoryProcessedEvents(), () => undefined, undefined, undefined, undefined, new DirectoryRepository(pool),
    );
  });

  afterAll(async () => {
    await pool?.end();
    await fixture?.stop();
  });

  it('đồng bộ người dùng và giữ tên mới khi sự kiện đăng ký tới trễ', async () => {
    const userId = randomUUID();
    const registered = event('access.user.registered', older, { userId, displayName: 'Tên cũ' });
    const updated = event('access.user.profile_updated', newer, { userId, displayName: 'Tên mới' });
    expect(await router.route(updated)).toBe('handled');
    expect(await router.route(registered)).toBe('handled');
    expect(await router.route(updated)).toBe('duplicate');
    const { rows } = await pool.query('SELECT display_name, email FROM user_directory WHERE user_id = $1', [userId]);
    expect(rows).toEqual([{ display_name: 'Tên mới', email: null }]);
    expect(mailer.sent).toHaveLength(0);
  });

  it('TF109: lưu ảnh đại diện; sự kiện cũ không có avatarUrl thì giữ ảnh, null thì xoá', async () => {
    const userId = randomUUID();
    const at = (minute: number) => `2026-11-12T10:0${minute}:00.000Z`;
    const avatarOf = async () =>
      (await pool.query('SELECT avatar_url FROM user_directory WHERE user_id = $1', [userId])).rows[0]?.avatar_url;
    await router.route(event('access.user.registered', at(1), { userId, displayName: 'An', avatarUrl: 'https://anh/1' }));
    expect(await avatarOf()).toBe('https://anh/1');
    await router.route(event('access.user.profile_updated', at(2), { userId, displayName: 'An mới' }));
    expect(await avatarOf()).toBe('https://anh/1');
    await router.route(event('access.user.profile_updated', at(3), { userId, displayName: 'An mới', avatarUrl: null }));
    expect(await avatarOf()).toBeNull();
  });

  it('đồng bộ bài đã đăng và giữ dấu xóa khi nhận sai thứ tự', async () => {
    const authorId = randomUUID();
    const publishedId = randomUUID();
    const deletedId = randomUUID();
    const publish = (postId: string) =>
      event('content.post.published', older, { postId, authorId, title: 'Bài thử', publishedAt: older });
    expect(await router.route(publish(publishedId))).toBe('handled');
    expect(await router.route(event('content.post.deleted', newer, {
      postId: deletedId, authorId, deletedAt: newer,
    }))).toBe('handled');
    expect(await router.route(publish(deletedId))).toBe('handled');
    const { rows } = await pool.query(
      'SELECT post_id, author_id, title, deleted_at FROM post_directory WHERE post_id = ANY($1::uuid[])',
      [[publishedId, deletedId]],
    );
    expect(rows).toHaveLength(2);
    expect(rows).toEqual(expect.arrayContaining([
      { post_id: publishedId, author_id: authorId, title: 'Bài thử', deleted_at: null },
      { post_id: deletedId, author_id: authorId, title: null, deleted_at: new Date(newer) },
    ]));
  });
});
