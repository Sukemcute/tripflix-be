import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { startPostgres, type PostgresFixture } from '@tripflix/testing';
import pg from 'pg';
import { envSchema } from '../env.js';
import { InboxRepository } from '../inbox/inbox.repository.js';
import { MAX_PUSH_TOKENS_PER_USER, PushWorker } from './push.worker.js';

const token = (name: string) => `ExponentPushToken[${name}]`;

describe('N3: push mobile qua Expo trên PostgreSQL', () => {
  let fixture: PostgresFixture;
  let pool: pg.Pool;
  let worker: PushWorker;
  let expoTickets: (messages: { to: string }[]) => Response;
  const sent: { to: string; title: string; body: string; data: unknown }[] = [];

  beforeAll(async () => {
    fixture = await startPostgres();
    const url = fixture.buildModuleUrl('notification');
    pool = new pg.Pool({ connectionString: url });
    await new InboxRepository(pool).onModuleInit();
    worker = new PushWorker(pool, envSchema.parse({ DATABASE_URL_NOTIFICATION: url, PUSH_ENABLED: 'true' }));
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const messages = JSON.parse(String(init?.body)) as typeof sent;
      sent.push(...messages);
      return expoTickets(messages);
    });
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await pool?.end();
    await fixture?.stop();
  });

  beforeEach(() => {
    sent.length = 0;
    expoTickets = (messages) => Response.json({ data: messages.map(() => ({ status: 'ok', id: randomUUID() })) });
  });

  async function addRow(userId: string, overrides: { body?: string; readAt?: Date } = {}) {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO inbox (user_id, type, title, body, link, source_event_id, read_at)
       VALUES ($1, 'comment.replied', 'Trang đã trả lời bình luận', $2, '/trips/p1', $3, $4) RETURNING id`,
      [userId, overrides.body ?? 'Trang đã trả lời bình luận của bạn.', randomUUID(), overrides.readAt ?? null],
    );
    return rows[0]!.id;
  }

  async function delivery(inboxId: string) {
    return (await pool.query('SELECT status, attempts, last_error FROM deliveries WHERE inbox_id = $1 AND channel = $2', [inboxId, 'push'])).rows[0];
  }

  it('đẩy dòng mới tới mọi máy của người nhận một lần, kèm link để mở đúng chỗ', async () => {
    const userId = randomUUID();
    await worker.registerToken(userId, token('phone'), 'android');
    await worker.registerToken(userId, token('tablet'), 'ios');
    const inboxId = await addRow(userId);
    await worker.runOnce();
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({
      title: 'Trang đã trả lời bình luận', body: 'Trang đã trả lời bình luận của bạn.', data: { inboxId, link: '/trips/p1' },
    });
    expect(await delivery(inboxId)).toMatchObject({ status: 'sent', attempts: 1 });
    await worker.runOnce();
    expect(sent).toHaveLength(2);
  });

  it('không đẩy dòng đã đọc, đã ẩn, của người không có máy, hoặc có từ trước khi bật push', async () => {
    const userId = randomUUID();
    await worker.registerToken(userId, token('only'), 'android');
    await addRow(userId, { readAt: new Date() });
    const hidden = await addRow(userId);
    await pool.query('UPDATE inbox SET deleted_at = now() WHERE id = $1', [hidden]);
    const legacy = await addRow(userId);
    await pool.query('UPDATE inbox SET updated_at = NULL WHERE id = $1', [legacy]);
    const stale = await addRow(userId);
    await pool.query("UPDATE inbox SET updated_at = now() - interval '11 minutes' WHERE id = $1", [stale]);
    await addRow(randomUUID());
    await worker.runOnce();
    expect(sent).toEqual([]);
  });

  it('dòng gom có thêm người: chờ hết 3 phút mới đẩy lại; đổi dữ liệu khác hoặc đọc dòng không làm đẩy lại', async () => {
    const userId = randomUUID();
    await worker.registerToken(userId, token('grouped'), 'android');
    const inboxId = await addRow(userId, { body: 'Dương đã trả lời trong luồng bạn tham gia.' });
    await worker.runOnce();
    await pool.query("UPDATE inbox SET body = 'Dương và 1 người khác đã trả lời trong luồng bạn tham gia.' WHERE id = $1", [inboxId]);
    await worker.runOnce();
    expect(sent).toHaveLength(1);

    await pool.query("UPDATE deliveries SET updated_at = now() - interval '4 minutes' WHERE inbox_id = $1", [inboxId]);
    await worker.runOnce();
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatchObject({ body: 'Dương và 1 người khác đã trả lời trong luồng bạn tham gia.' });

    // Đã đẩy bản mới nhất cách đây 4 phút (sau lần đổi nội dung cách đây 5 phút).
    await pool.query("UPDATE inbox SET updated_at = now() - interval '5 minutes' WHERE id = $1", [inboxId]);
    await pool.query("UPDATE deliveries SET updated_at = now() - interval '4 minutes' WHERE inbox_id = $1", [inboxId]);
    const before = (await pool.query('SELECT updated_at FROM inbox WHERE id = $1', [inboxId])).rows[0].updated_at;
    await pool.query("UPDATE inbox SET data = data || '{\"actorIds\": []}'::jsonb WHERE id = $1", [inboxId]);
    await worker.runOnce();
    expect(sent).toHaveLength(2);
    await pool.query('UPDATE inbox SET read_at = now() WHERE id = $1', [inboxId]);
    expect((await pool.query('SELECT updated_at FROM inbox WHERE id = $1', [inboxId])).rows[0].updated_at).toEqual(before);
  });

  it('Expo báo DeviceNotRegistered thì xoá máy đó; Expo lỗi thì ghi failed và chờ hết khoảng nghỉ', async () => {
    const userId = randomUUID();
    await worker.registerToken(userId, token('dead'), 'android');
    expoTickets = (messages) => Response.json({
      data: messages.map(() => ({ status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } })),
    });
    const first = await addRow(userId);
    await worker.runOnce();
    expect(await delivery(first)).toMatchObject({ status: 'failed', last_error: 'DeviceNotRegistered' });
    expect((await pool.query('SELECT 1 FROM push_tokens WHERE user_id = $1', [userId])).rowCount).toBe(0);

    const other = randomUUID();
    await worker.registerToken(other, token('alive'), 'ios');
    expoTickets = () => new Response('lỗi', { status: 500 });
    const second = await addRow(other);
    await worker.runOnce();
    expect(await delivery(second)).toMatchObject({ status: 'failed', last_error: 'Expo trả HTTP 500' });
    sent.length = 0;
    await worker.runOnce();
    expect(sent).toEqual([]);
  });

  it('token chuyển sang tài khoản mới, mỗi người giữ tối đa 10 máy, khoá tài khoản thì xoá hết', async () => {
    const [first, second] = [randomUUID(), randomUUID()];
    await worker.registerToken(first, token('shared'), 'android');
    await worker.registerToken(second, token('shared'), 'android');
    const owners = await pool.query('SELECT user_id FROM push_tokens WHERE token = $1', [token('shared')]);
    expect(owners.rows).toEqual([{ user_id: second }]);

    for (let i = 0; i <= MAX_PUSH_TOKENS_PER_USER; i += 1) await worker.registerToken(first, token(`device${i}`), 'ios');
    const kept = await pool.query<{ token: string }>('SELECT token FROM push_tokens WHERE user_id = $1', [first]);
    expect(kept.rowCount).toBe(MAX_PUSH_TOKENS_PER_USER);
    expect(kept.rows.map((row) => row.token)).not.toContain(token('device0'));

    await worker.removeToken(second, token('device1'));
    expect((await pool.query('SELECT 1 FROM push_tokens WHERE token = $1', [token('device1')])).rowCount).toBe(1);
    await worker.removeUserTokens(first);
    expect((await pool.query('SELECT 1 FROM push_tokens WHERE user_id = $1', [first])).rowCount).toBe(0);
  });
});
