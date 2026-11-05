import { fileURLToPath } from 'node:url';
import { createDb, createPool } from '@tripflix/db';
import { migrateModule, startPostgres, type PostgresFixture } from '@tripflix/testing';
import { eq, inArray } from 'drizzle-orm';
import type pg from 'pg';
import { accessOutboxEvents, sessions } from '../../db/schema/index.js';
import { hashRefreshToken } from '../application/refresh-token.js';
import { PUBLISHED_EVENT_RETENTION_MS, runAccessCleanup } from '../jobs/access-cleanup.job.js';
import { DrizzleAccessStore } from './drizzle-access.store.js';

// docs/architecture/11 §6: xoay vòng refresh token phải đúng trên Postgres thật, kể cả khi nhiều request cùng lúc.
describe('DrizzleAccessStore trên Postgres thật (user tf_access)', () => {
  let postgres: PostgresFixture;
  let pool: pg.Pool;
  let store: DrizzleAccessStore;
  let db: ReturnType<typeof createDb>;

  beforeAll(async () => {
    postgres = await startPostgres();
    const url = postgres.buildModuleUrl('access');
    await migrateModule({
      url,
      module: 'access',
      migrationsFolder: fileURLToPath(new URL('../../db/migrations', import.meta.url)),
    });
    pool = createPool({ url, max: 10, applicationName: 'access-int-test' });
    db = createDb(pool);
    store = new DrizzleAccessStore(() => db);
  });

  afterAll(async () => {
    await pool?.end();
    await postgres?.stop();
  });

  const DAY = 86_400_000;

  async function addSession(userId: string, token: string, expiresAt = new Date(Date.now() + DAY)) {
    return store.sessions.insert({
      userId,
      refreshTokenHash: hashRefreshToken(token),
      expiresAt,
      deviceName: token,
      userAgent: null,
      ip: null,
    });
  }

  async function createSession(email: string) {
    const user = await store.users.insert({ email, passwordHash: 'x', displayName: 'Test', role: 'member' });
    const refreshTokenHash = hashRefreshToken(`token-${email}`);
    const session = await store.sessions.insert({
      userId: user!.id,
      refreshTokenHash,
      expiresAt: new Date(Date.now() + 86_400_000),
      deviceName: null,
      userAgent: null,
      ip: null,
    });
    return { session, refreshTokenHash };
  }

  it('10 lệnh xoay vòng cùng lúc với cùng token hiện tại: chỉ đúng 1 thành công', async () => {
    const { session, refreshTokenHash } = await createSession('race@example.com');
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        store.sessions.rotate(session.id, refreshTokenHash, {
          refreshTokenHash: hashRefreshToken(`next-${i}`),
          previousTokenHash: refreshTokenHash,
          rotatedAt: new Date(),
          expiresAt: new Date(Date.now() + 86_400_000),
          lastUsedAt: new Date(),
        }),
      ),
    );
    expect(results.filter(Boolean)).toHaveLength(1);

    const winner = results.findIndex(Boolean);
    const stored = await store.sessions.findByTokenHash(hashRefreshToken(`next-${winner}`));
    expect(stored).toMatchObject({ id: session.id, previousTokenHash: refreshTokenHash });
  });

  it('tìm được phiên theo token liền trước sau khi xoay; xoá phiên thì không tìm thấy nữa', async () => {
    const { session, refreshTokenHash } = await createSession('rotate@example.com');
    await store.sessions.rotate(session.id, refreshTokenHash, {
      refreshTokenHash: hashRefreshToken('rotated'),
      previousTokenHash: refreshTokenHash,
      rotatedAt: new Date(),
      expiresAt: new Date(Date.now() + 86_400_000),
      lastUsedAt: new Date(),
    });
    expect((await store.sessions.findByTokenHash(refreshTokenHash))?.id).toBe(session.id);
    expect(await store.sessions.delete(session.id)).toBe(true);
    expect(await store.sessions.findByTokenHash(hashRefreshToken('rotated'))).toBeNull();
  });

  it('search tìm theo email hoặc tên, phân trang, thoát ký tự % trong từ khoá', async () => {
    await store.users.insert({ email: 'search-a@example.com', passwordHash: 'x', displayName: 'Nguyễn An', role: 'member' });
    await store.users.insert({ email: 'search-b@example.com', passwordHash: 'x', displayName: '100% Bình', role: 'member' });
    expect((await store.users.search({ query: 'search-', limit: 1, offset: 0 })).total).toBe(2);
    expect((await store.users.search({ query: 'search-', limit: 1, offset: 0 })).items).toHaveLength(1);
    expect((await store.users.search({ query: 'NGUYỄN', limit: 10, offset: 0 })).items[0]?.email).toBe('search-a@example.com');
    // "%" là chữ thường, không phải ký tự đại diện: chỉ khớp "100% Bình".
    const percent = await store.users.search({ query: '%', limit: 10, offset: 0 });
    expect(percent.items.map((u) => u.email)).toEqual(['search-b@example.com']);
  });

  it('updateRole, updateStatus đổi đúng dòng; deleteByUser xoá mọi phiên và trả sid', async () => {
    const { session } = await createSession('staff@example.com');
    const second = await store.sessions.insert({
      userId: session.userId,
      refreshTokenHash: hashRefreshToken('second'),
      expiresAt: new Date(Date.now() + 86_400_000),
      deviceName: null,
      userAgent: null,
      ip: null,
    });
    expect((await store.users.updateRole(session.userId, 'moderator'))?.role).toBe('moderator');
    expect((await store.users.updateStatus(session.userId, 'locked'))?.status).toBe('locked');
    expect((await store.sessions.deleteByUser(session.userId)).sort()).toEqual([session.id, second.id].sort());
    expect(await store.sessions.deleteByUser(session.userId)).toEqual([]);
    expect(await store.users.updateRole('0c6a1d3e-7f0e-4c39-9a7f-111111111111', 'member')).toBeNull();
  });

  it('TF055: listActiveByUser bỏ phiên hết hạn; deleteOwned chỉ xoá phiên của đúng người; deleteByUser giữ exceptId', async () => {
    const { session: current } = await createSession('account@example.com');
    const other = await addSession(current.userId, 'laptop');
    await addSession(current.userId, 'old-phone', new Date(Date.now() - 1000));
    const { session: stranger } = await createSession('stranger@example.com');

    const listed = await store.sessions.listActiveByUser(current.userId, new Date());
    expect(listed.map((s) => s.id).sort()).toEqual([current.id, other.id].sort());
    expect(Object.keys(listed[0]!).sort()).toEqual(['createdAt', 'deviceName', 'id', 'lastUsedAt', 'userAgent']);

    expect(await store.sessions.deleteOwned(stranger.id, current.userId)).toBe(false);
    expect(await store.sessions.findByTokenHash(hashRefreshToken('token-stranger@example.com'))).not.toBeNull();

    // Đổi mật khẩu: xoá mọi phiên trừ phiên đang dùng (kể cả phiên hết hạn).
    expect(await store.sessions.deleteByUser(current.userId, current.id)).toHaveLength(2);
    expect((await store.sessions.listActiveByUser(current.userId, new Date())).map((s) => s.id)).toEqual([current.id]);
    expect(await store.sessions.deleteOwned(current.id, current.userId)).toBe(true);
  });

  it('TF055: updateDisplayName, updatePasswordHash đổi đúng dòng', async () => {
    const user = await store.users.insert({ email: 'profile@example.com', passwordHash: 'old', displayName: 'A', role: 'member' });
    expect((await store.users.updateDisplayName(user!.id, 'Bình'))?.displayName).toBe('Bình');
    expect((await store.users.updatePasswordHash(user!.id, 'new'))?.passwordHash).toBe('new');
    expect(await store.users.findById(user!.id)).toMatchObject({ displayName: 'Bình', passwordHash: 'new', email: 'profile@example.com' });
  });

  it('TF055: job dọn xoá phiên hết hạn và sự kiện đã gửi quá 7 ngày, giữ phần còn lại', async () => {
    const now = new Date();
    const user = await store.users.insert({ email: 'cleanup@example.com', passwordHash: 'x', displayName: 'C', role: 'member' });
    const expired = await addSession(user!.id, 'cleanup-expired', new Date(now.getTime() - 1000));
    const alive = await addSession(user!.id, 'cleanup-alive');

    const oldId = await store.outbox.add({ type: 'access.user.registered', userId: user!.id, payload: { n: 'old' } });
    const recentId = await store.outbox.add({ type: 'access.user.registered', userId: user!.id, payload: { n: 'recent' } });
    const pendingId = await store.outbox.add({ type: 'access.user.registered', userId: user!.id, payload: { n: 'pending' } });
    const published = (ms: number) => new Date(now.getTime() - ms);
    await db.update(accessOutboxEvents).set({ publishedAt: published(PUBLISHED_EVENT_RETENTION_MS + DAY) }).where(eq(accessOutboxEvents.id, oldId));
    await db.update(accessOutboxEvents).set({ publishedAt: published(DAY) }).where(eq(accessOutboxEvents.id, recentId));

    const result = await runAccessCleanup({ sessions: store.sessions, db, now });
    // Phiên hết hạn của các test trước cũng bị dọn, nên chỉ kiểm tối thiểu.
    expect(result.expiredSessions).toBeGreaterThanOrEqual(1);
    expect(result.publishedEvents).toBe(1);

    const leftSessions = await db.select({ id: sessions.id }).from(sessions).where(inArray(sessions.id, [expired.id, alive.id]));
    expect(leftSessions.map((r) => r.id)).toEqual([alive.id]);
    const leftEvents = await db
      .select({ id: accessOutboxEvents.id })
      .from(accessOutboxEvents)
      .where(inArray(accessOutboxEvents.id, [oldId, recentId, pendingId]));
    expect(leftEvents.map((r) => r.id).sort()).toEqual([recentId, pendingId].sort());

    // Chạy lại không còn gì để dọn.
    expect(await runAccessCleanup({ sessions: store.sessions, db, now })).toEqual({ expiredSessions: 0, publishedEvents: 0 });
  });

  it('TF058: service_clients lưu mảng audience, trùng clientId trả null, disable giữ mốc đầu tiên', async () => {
    const created = await store.serviceClients.insert({
      clientId: 'ai-service',
      secretHash: '$argon2id$x',
      allowedAudiences: ['core-api', 'notification-service'],
    });
    expect(created).toMatchObject({ clientId: 'ai-service', allowedAudiences: ['core-api', 'notification-service'], disabledAt: null });
    expect(await store.serviceClients.insert({ clientId: 'ai-service', secretHash: 'y', allowedAudiences: ['core-api'] })).toBeNull();

    const first = new Date('2026-11-05T01:00:00Z');
    expect(await store.serviceClients.disable('ai-service', first)).toBe(true);
    expect(await store.serviceClients.disable('ai-service', new Date('2026-11-06T01:00:00Z'))).toBe(true);
    expect((await store.serviceClients.findById('ai-service'))?.disabledAt?.toISOString()).toBe(first.toISOString());
    expect(await store.serviceClients.disable('khong-co', first)).toBe(false);
    expect(await store.serviceClients.findById('khong-co')).toBeNull();
  });

  it('TF058: ràng buộc database chặn clientId sai dạng và danh sách audience rỗng', async () => {
    await expect(store.serviceClients.insert({ clientId: 'AI Service', secretHash: 'x', allowedAudiences: ['core-api'] })).rejects.toThrow();
    await expect(store.serviceClients.insert({ clientId: 'empty-aud', secretHash: 'x', allowedAudiences: [] })).rejects.toThrow();
  });

  it('email trùng thì insert trả null, không ném lỗi', async () => {
    await store.users.insert({ email: 'dup@example.com', passwordHash: 'x', displayName: 'A', role: 'member' });
    expect(
      await store.users.insert({ email: 'dup@example.com', passwordHash: 'y', displayName: 'B', role: 'member' }),
    ).toBeNull();
  });
});
