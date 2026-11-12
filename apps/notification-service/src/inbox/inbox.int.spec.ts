import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { AuthModule, InvalidAccessTokenError, MemorySidBlocklist } from '@tripflix/auth';
import { startPostgres, type PostgresFixture } from '@tripflix/testing';
import pg from 'pg';
import request from 'supertest';
import { RealtimeService } from '../realtime/realtime.service.js';
import { InboxController } from './inbox.controller.js';
import { decodeInboxCursor, InboxRepository, type InboxInsert, type InboxRow } from './inbox.repository.js';
import { ensureInboxSchema } from './inbox.schema.js';

describe('InboxRepository trên Postgres thật', () => {
  let fixture: PostgresFixture;
  let pool: pg.Pool;
  let repository: InboxRepository;
  const legacyItem = input();
  const legacyReadAt = new Date('2026-11-12T10:00:00.000Z');

  beforeAll(async () => {
    fixture = await startPostgres();
    pool = new pg.Pool({ connectionString: fixture.buildModuleUrl('notification') });
    await pool.query(`
      CREATE TABLE inbox (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL,
        type text NOT NULL,
        title text NOT NULL,
        body text NOT NULL,
        link text,
        data jsonb NOT NULL DEFAULT '{}',
        source_event_id text NOT NULL CONSTRAINT uq_inbox_source_event_id UNIQUE,
        created_at timestamptz NOT NULL DEFAULT now(),
        read_at timestamptz
      )
    `);
    await pool.query(
      'INSERT INTO inbox (user_id, type, title, body, source_event_id, read_at) VALUES ($1, $2, $3, $4, $5, $6)',
      [legacyItem.userId, legacyItem.type, legacyItem.title, legacyItem.body, legacyItem.sourceEventId, legacyReadAt],
    );
    repository = new InboxRepository(pool);
    await Promise.all([repository.onModuleInit(), ensureInboxSchema(pool)]);
  });

  afterAll(async () => {
    await pool?.end();
    await fixture?.stop();
  });

  function input(userId: string = randomUUID()): InboxInsert {
    return {
      userId,
      type: 'booking.paid',
      title: 'Đặt chỗ thành công',
      body: 'Đã thanh toán',
      link: '/bookings',
      data: { orderId: randomUUID() },
      sourceEventId: randomUUID(),
    };
  }

  async function insert(userId: string): Promise<InboxRow> {
    const row = await repository.insert(input(userId));
    if (!row) throw new Error('Không tạo được thông báo trong fixture');
    return row;
  }

  it('DDL chạy lại an toàn, tạo đủ index và constraint', async () => {
    await ensureInboxSchema(pool);
    await ensureInboxSchema(pool);
    const indexes = await pool.query<{ indexname: string }>(
      "SELECT indexname FROM pg_indexes WHERE tablename = 'inbox' AND schemaname = current_schema()",
    );
    const indexNames = indexes.rows.map((row) => row.indexname);
    expect(indexNames).toEqual(
      expect.arrayContaining([
        'inbox_pkey',
        'uq_inbox_event_user_type',
        'idx_inbox_user_id_created_at',
        'idx_inbox_user_id_unread',
      ]),
    );
    expect(indexNames).toContain('uq_inbox_group_key');
    expect(indexNames).not.toContain('uq_inbox_source_event_id');
    const migrations = await pool.query<{ version: number }>('SELECT version FROM __migrations ORDER BY version');
    expect(migrations.rows).toEqual([{ version: 1 }, { version: 2 }, { version: 3 }, { version: 4 }]);
  });

  it('giữ thông báo đã đọc và chống ghi lại sự kiện đã xử lý trước khi migrate', async () => {
    const page = await repository.listForUser(legacyItem.userId, { limit: 10 });
    expect(page.items).toEqual([
      expect.objectContaining({ source_event_id: legacyItem.sourceEventId, read_at: legacyReadAt }),
    ]);
    expect(await repository.insert(legacyItem)).toBeNull();
    const tables = await pool.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = current_schema()",
    );
    expect(tables.rows.map((row) => row.tablename)).toEqual(
      expect.arrayContaining(['deliveries', 'user_directory', 'post_directory']),
    );
  });

  it('insert trả hàng với default; cùng sự kiện, người nhận và loại không ghi đè', async () => {
    const item = input();
    const row = await repository.insert(item);
    expect(row).toMatchObject({
      user_id: item.userId,
      source_event_id: item.sourceEventId,
      data: item.data,
      read_at: null,
      title: item.title,
    });
    expect(row?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(row?.created_at).toBeInstanceOf(Date);
    expect(await repository.insert({ ...item, title: 'Không ghi đè' })).toBeNull();
    const page = await repository.listForUser(item.userId, { limit: 20 });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.title).toBe(item.title);
  });

  it('một sự kiện ghi được cho nhiều người và nhiều loại, phát lại đồng thời không tạo bản trùng', async () => {
    const item = input();
    const otherRecipient = { ...item, userId: randomUUID() };
    const otherType = { ...item, type: 'booking.cancelled' };
    const inserts = [item, otherRecipient, otherType];
    const results = await Promise.all([...inserts, ...inserts].map((entry) => repository.insert(entry)));
    expect(results.filter((row) => row !== null)).toHaveLength(3);

    const first = await repository.listForUser(item.userId, { limit: 10 });
    expect(first.items.map((row) => row.type).sort()).toEqual([item.type, otherType.type].sort());
    const second = await repository.listForUser(otherRecipient.userId, { limit: 10 });
    expect(second.items).toEqual([expect.objectContaining({ type: item.type, source_event_id: item.sourceEventId })]);
  });

  it('sắp mới nhất trước, phân trang theo id khi cùng thời gian, không lẫn người dùng', async () => {
    const userId = randomUUID();
    const rows = await Promise.all([insert(userId), insert(userId), insert(userId), insert(userId)]);
    await insert(randomUUID());
    const ids = rows.map((row) => row.id);
    await pool.query('UPDATE inbox SET created_at = $1 WHERE id = ANY($2::uuid[])', [
      '2026-11-12T12:00:00.123456Z',
      ids,
    ]);
    const older = await insert(userId);
    await pool.query('UPDATE inbox SET created_at = $1 WHERE id = $2', ['2026-11-11T12:00:00Z', older.id]);
    const first = await repository.listForUser(userId, { limit: 2 });
    expect(first.items.map((row) => row.id)).toEqual([...ids].sort().reverse().slice(0, 2));
    expect(first.nextCursor).not.toBeNull();
    expect(decodeInboxCursor(first.nextCursor!)[0]).toBe('2026-11-12T12:00:00.123456Z');
    const second = await repository.listForUser(userId, { limit: 2, cursor: first.nextCursor! });
    expect(second.items.map((row) => row.id)).toEqual([...ids].sort().reverse().slice(2));
    const third = await repository.listForUser(userId, { limit: 2, cursor: second.nextCursor! });
    expect(third.items.map((row) => row.id)).toEqual([older.id]);
    expect(third.nextCursor).toBeNull();
    const empty = await repository.listForUser(randomUUID(), { limit: 20 });
    expect(empty).toEqual({ items: [], nextCursor: null });
  });

  it('phân trang không bỏ sót hai thời điểm khác nhau trong cùng millisecond', async () => {
    const userId = randomUUID();
    const newer = await insert(userId);
    const older = await insert(userId);
    await pool.query('UPDATE inbox SET created_at = $1 WHERE id = $2', [
      '2026-11-12T12:00:00.123456Z',
      newer.id,
    ]);
    await pool.query('UPDATE inbox SET created_at = $1 WHERE id = $2', [
      '2026-11-12T12:00:00.123123Z',
      older.id,
    ]);
    const page = await repository.listForUser(userId, { limit: 1 });
    expect(page.items[0]?.id).toBe(newer.id);
    const next = await repository.listForUser(userId, { limit: 1, cursor: page.nextCursor! });
    expect(next.items[0]?.id).toBe(older.id);
    expect(next.nextCursor).toBeNull();
  });

  it('đếm chưa đọc, chỉ đánh dấu hàng của mình và giữ thời điểm đọc khi gọi lại', async () => {
    const userId = randomUUID();
    const otherUserId = randomUUID();
    const own = await insert(userId);
    await insert(userId);
    const foreign = await insert(otherUserId);
    expect(await repository.countUnread(userId)).toBe(2);
    expect(await repository.markRead(userId, foreign.id)).toBe(false);
    expect(await repository.markRead(userId, randomUUID())).toBe(false);
    expect(await repository.countUnread(otherUserId)).toBe(1);
    expect(await repository.markRead(userId, own.id)).toBe(true);
    expect(await repository.countUnread(userId)).toBe(1);
    const firstRead = (await repository.listForUser(userId, { limit: 20 })).items.find(
      (row) => row.id === own.id,
    )?.read_at;
    expect(firstRead).toBeInstanceOf(Date);
    expect(await repository.markRead(userId, own.id)).toBe(true);
    const secondRead = (await repository.listForUser(userId, { limit: 20 })).items.find(
      (row) => row.id === own.id,
    )?.read_at;
    expect(secondRead).toEqual(firstRead);
  });

  it('đánh dấu tất cả chỉ trả số hàng vừa đổi của người gọi', async () => {
    const userId = randomUUID();
    const otherUserId = randomUUID();
    const read = await insert(userId);
    await insert(userId);
    await insert(userId);
    await insert(otherUserId);
    await repository.markRead(userId, read.id);
    expect(await repository.markAllRead(userId)).toBe(2);
    expect(await repository.countUnread(userId)).toBe(0);
    expect(await repository.countUnread(otherUserId)).toBe(1);
    expect(await repository.markAllRead(userId)).toBe(0);
    expect(await repository.markAllRead(randomUUID())).toBe(0);
  });

  it('API lọc tab, bảo vệ dữ liệu hai tài khoản và giữ thông báo đến sau mốc đọc', async () => {
    const userId = randomUUID();
    const otherUserId = randomUUID();
    const realtime = { emitToUser: vi.fn() };
    const module = await Test.createTestingModule({
      imports: [AuthModule.forRootAsync({
        useFactory: () => ({
          verifier: async (token: string) => {
            if (token !== 'first' && token !== 'second') throw new InvalidAccessTokenError();
            return {
              userId: token === 'first' ? userId : otherUserId,
              role: 'member' as const,
              sid: token,
              exp: 2_000_000_000,
            };
          },
          blocklist: new MemorySidBlocklist(),
        }),
      })],
      controllers: [InboxController],
      providers: [
        { provide: InboxRepository, useValue: repository },
        { provide: RealtimeService, useValue: realtime },
      ],
    }).compile();
    const app = module.createNestApplication();
    app.setGlobalPrefix('notifications');
    try {
      await app.init();
      const http = request(app.getHttpServer());
      const auth = { Authorization: 'Bearer first' };
      const second = { Authorization: 'Bearer second' };
      const booking = await insert(userId);
      const interaction = await repository.insert({ ...input(userId), type: 'comment.created' });
      const foreign = await insert(otherUserId);
      if (!interaction) throw new Error('Không tạo được thông báo tương tác');
      const setTime = (id: string, time: string) => pool.query('UPDATE inbox SET created_at = $1 WHERE id = $2', [time, id]);
      await setTime(booking.id, '2026-11-12T09:00:00.000001Z');
      await setTime(interaction.id, '2026-11-12T09:00:00.000002Z');

      await http.get('/notifications/unread-count').expect(401);
      const orders = await http.get('/notifications?tab=orders').set(auth).expect(200);
      expect(orders.body.items.map((item: { id: string }) => item.id)).toEqual([booking.id]);
      expect(orders.body.unreadCount).toBe(2);
      const interactions = await http.get('/notifications?tab=interactions').set(auth).expect(200);
      expect(interactions.body.items.map((item: { id: string }) => item.id)).toEqual([interaction.id]);
      await http.get('/notifications?tab=invalid').set(auth).expect(400);
      await http.get('/notifications/unread-count').set(auth).expect('Cache-Control', 'no-store').expect(200, { unreadCount: 2 });
      await http.post(`/notifications/${foreign.id}/read`).set(auth).expect(404);
      await http.post('/notifications/read-all').set(auth).send({ throughId: foreign.id }).expect(404);
      await http.post('/notifications/read-all').set(auth).send({ throughId: 'invalid' }).expect(400);
      expect(realtime.emitToUser).not.toHaveBeenCalled();

      const arrival = await insert(userId);
      await setTime(arrival.id, '2026-11-12T09:00:00.000003Z');
      await http.post('/notifications/read-all').set(auth).send({ throughId: interaction.id }).expect(201, { unreadCount: 1 });
      expect(realtime.emitToUser).toHaveBeenCalledWith(userId, 'notification.read', { throughId: interaction.id, unreadCount: 1 });
      await http.get('/notifications/unread-count').set(second).expect(200, { unreadCount: 1 });
      await http.post(`/notifications/${arrival.id}/read`).set(auth).expect(201, { unreadCount: 0 });
      expect(realtime.emitToUser).toHaveBeenLastCalledWith(userId, 'notification.read', { id: arrival.id, unreadCount: 0 });
      await http.post('/notifications/read-all').set(second).expect(201, { unreadCount: 0 });
    } finally {
      await app.close();
    }
  });
});
