import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { startPostgres, type PostgresFixture } from '@tripflix/testing';
import pg from 'pg';
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
    expect(indexes.rows.map((row) => row.indexname)).toEqual(
      expect.arrayContaining([
        'inbox_pkey',
        'uq_inbox_source_event_id',
        'uq_inbox_event_user_type',
        'idx_inbox_user_id_created_at',
        'idx_inbox_user_id_unread',
      ]),
    );
  });

  it('giữ thông báo đã đọc và tương thích với câu lệnh ghi của phiên bản cũ', async () => {
    const page = await repository.listForUser(legacyItem.userId, { limit: 10 });
    expect(page.items).toEqual([
      expect.objectContaining({ source_event_id: legacyItem.sourceEventId, read_at: legacyReadAt }),
    ]);
    const duplicate = await pool.query(
      `INSERT INTO inbox (user_id, type, title, body, source_event_id)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (source_event_id) DO NOTHING`,
      [legacyItem.userId, legacyItem.type, legacyItem.title, legacyItem.body, legacyItem.sourceEventId],
    );
    expect(duplicate.rowCount).toBe(0);
    const tables = await pool.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = current_schema()",
    );
    expect(tables.rows.map((row) => row.tablename)).toEqual(
      expect.arrayContaining(['deliveries', 'user_directory', 'post_directory']),
    );
  });

  it('insert trả hàng với default; source_event_id trùng trả null và không ghi đè', async () => {
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
});
