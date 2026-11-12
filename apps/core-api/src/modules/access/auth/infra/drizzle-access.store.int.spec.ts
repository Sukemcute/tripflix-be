import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createDb, createPool } from '@tripflix/db';
import { migrateModule, startPostgres, type PostgresFixture } from '@tripflix/testing';
import { eq, inArray } from 'drizzle-orm';
import type pg from 'pg';
import { accessOutboxEvents, passwordResets, sessions, users } from '../../db/schema/index.js';
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

  it('searchPublic khớp tên không dấu, bỏ email và tài khoản khoá', async () => {
    const active = await store.users.insert({ email: 'pub-bao@example.com', passwordHash: 'x', displayName: 'Lê ĐỨC Bảo', role: 'member' });
    const locked = await store.users.insert({ email: 'pub-locked@example.com', passwordHash: 'x', displayName: 'Bảo Khoá', role: 'member' });
    await store.users.updateStatus(locked!.id, 'locked');
    const names = async (query: string) => (await store.users.searchPublic({ query, limit: 10, offset: 0 })).map((u) => u.id);
    expect(await names('duc bao')).toEqual([active!.id]);
    expect(await names('bao')).toEqual([active!.id]);
    expect(await names('pub-')).toEqual([]);
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

  it('TF055: updateProfile (tên), updatePasswordHash đổi đúng dòng', async () => {
    const user = await store.users.insert({ email: 'profile@example.com', passwordHash: 'old', displayName: 'A', role: 'member' });
    expect((await store.users.updateProfile(user!.id, { displayName: 'Bình' }))?.displayName).toBe('Bình');
    expect((await store.users.updatePasswordHash(user!.id, 'new'))?.passwordHash).toBe('new');
    expect(await store.users.findById(user!.id)).toMatchObject({ displayName: 'Bình', passwordHash: 'new', email: 'profile@example.com' });
  });

  it('TF06M: thông tin cá nhân lưu, xoá được; DB chặn giá trị sai dù bỏ qua kiểm tra của API', async () => {
    const user = await store.users.insert({ email: 'personal@example.com', passwordHash: 'x', displayName: 'C', role: 'member' });
    expect(user!.personal).toEqual({ phone: null, dateOfBirth: null, gender: null, nationality: null });
    const saved = await store.users.updateProfile(user!.id, {
      phone: '+84912345678',
      dateOfBirth: '2000-05-20',
      gender: 'female',
      nationality: 'VN',
    });
    expect(saved?.personal).toEqual({ phone: '+84912345678', dateOfBirth: '2000-05-20', gender: 'female', nationality: 'VN' });
    expect((await store.users.findById(user!.id))?.personal.dateOfBirth).toBe('2000-05-20');
    expect((await store.users.updateProfile(user!.id, { phone: null, gender: null }))?.personal).toMatchObject({ phone: null, gender: null, nationality: 'VN' });
    for (const bad of [{ gender: 'unknown' }, { nationality: 'vn' }, { phone: '12ab' }] as never[]) {
      await expect(store.users.updateProfile(user!.id, bad)).rejects.toThrow();
    }
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

    const result = await runAccessCleanup({ sessions: store.sessions, passwordResets: store.passwordResets, emailVerifications: store.emailVerifications, registrationChallenges: store.registrationChallenges, db, now });
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
    expect(await runAccessCleanup({ sessions: store.sessions, passwordResets: store.passwordResets, emailVerifications: store.emailVerifications, registrationChallenges: store.registrationChallenges, db, now })).toEqual({
      expiredSessions: 0,
      expiredPasswordResets: 0,
      expiredEmailVerifications: 0,
      expiredRegistrationChallenges: 0,
      publishedEvents: 0,
    });
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

  it('TF05C: mỗi ràng buộc check của users chặn đúng giá trị sai khi ghi thẳng SQL (bỏ qua API)', async () => {
    const insertUser = (columns: Record<string, unknown>) => {
      const row = { email: `ck-${Math.random().toString(36).slice(2)}@example.com`, display_name: 'Ck', ...columns };
      const keys = Object.keys(row);
      return pool.query(`insert into access.users (${keys.join(', ')}) values (${keys.map((_, i) => `$${i + 1}`).join(', ')})`, Object.values(row));
    };
    const violated = async (columns: Record<string, unknown>) => {
      const err = await insertUser(columns).then(
        () => null,
        (e: { constraint?: string; code?: string }) => e,
      );
      return err?.constraint ?? err?.code ?? null;
    };

    for (const [columns, constraint] of [
      [{ role: 'admin' }, 'ck_users_role'],
      [{ status: 'banned' }, 'ck_users_status'],
      [{ email: 'Upper@Example.com' }, 'ck_users_email_lowercase'],
      [{ gender: 'Male' }, 'ck_users_gender'],
      [{ nationality: 'vn' }, 'ck_users_nationality'],
      [{ nationality: 'VNM' }, 'ck_users_nationality'],
      [{ phone: '1234567' }, 'ck_users_phone'],
      [{ phone: '+84 912345678' }, 'ck_users_phone'],
      [{ phone: '1234567890123456' }, 'ck_users_phone'],
    ] as const) {
      expect(await violated(columns), JSON.stringify(columns)).toBe(constraint);
    }
    // Ngày không có thật bị kiểu date của Postgres từ chối (22008: datetime_field_overflow).
    expect(await violated({ date_of_birth: '2001-02-29' })).toBe('22008');
    // Giá trị đúng ở biên đều ghi được.
    expect(await violated({ phone: '12345678', nationality: 'VN', gender: 'other', date_of_birth: '2000-02-29' })).toBeNull();
    expect(await violated({ phone: '+123456789012345' })).toBeNull();
    // Trùng email (đã viết thường): uq_users_email.
    await insertUser({ email: 'ck-dup@example.com' });
    expect(await violated({ email: 'ck-dup@example.com' })).toBe('uq_users_email');
  });

  it('TF05D: insert có email_verified_at; markEmailVerified đặt khi trống, giữ mốc đầu tiên', async () => {
    const google = await store.users.insert({ email: 'ev-google@example.com', passwordHash: null, displayName: 'G', role: 'member', emailVerifiedAt: new Date('2026-11-01T00:00:00Z') });
    expect(google?.emailVerifiedAt?.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    const plain = await store.users.insert({ email: 'ev-plain@example.com', passwordHash: 'x', displayName: 'P', role: 'member' });
    expect(plain?.emailVerifiedAt).toBeNull();
    const first = await store.users.markEmailVerified(plain!.id, new Date('2026-11-06T01:00:00Z'));
    expect(first?.emailVerifiedAt?.toISOString()).toBe('2026-11-06T01:00:00.000Z');
    const second = await store.users.markEmailVerified(plain!.id, new Date('2026-11-07T01:00:00Z'));
    expect(second?.emailVerifiedAt?.toISOString()).toBe('2026-11-06T01:00:00.000Z');
    expect(await store.users.markEmailVerified('00000000-0000-4000-8000-000000000000', new Date())).toBeNull();
    // Xoá mật khẩu (liên kết Google vào tài khoản chưa xác thực).
    expect((await store.users.updatePasswordHash(plain!.id, null))?.passwordHash).toBeNull();
  });

  it('TF05D: email_verifications: 10 lệnh cùng tiêu một token chỉ 1 thắng; xoá token chưa dùng, token hết hạn; xoá user thì xoá token', async () => {
    const user = await store.users.insert({ email: 'ev-token@example.com', passwordHash: 'x', displayName: 'T', role: 'member' });
    const now = new Date();
    await store.emailVerifications.insert({ userId: user!.id, tokenHash: 'ev-hash-1', expiresAt: new Date(now.getTime() + DAY) });
    const results = await Promise.all(Array.from({ length: 10 }, () => store.emailVerifications.consume('ev-hash-1', new Date())));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await store.emailVerifications.findUsable('ev-hash-1', new Date())).toBeNull();

    await store.emailVerifications.insert({ userId: user!.id, tokenHash: 'ev-hash-2', expiresAt: new Date(now.getTime() + DAY) });
    await store.emailVerifications.insert({ userId: user!.id, tokenHash: 'ev-hash-old', expiresAt: new Date(now.getTime() - DAY) });
    expect(await store.emailVerifications.findUsable('ev-hash-old', now)).toBeNull();
    expect(await store.emailVerifications.findUsable('ev-hash-2', now)).toEqual({ userId: user!.id });
    // Xoá token chưa dùng (gửi lại link): giữ token đã dùng.
    expect(await store.emailVerifications.deleteUnusedByUser(user!.id)).toBe(2);
    const left = await pool.query('select token_hash from access.email_verifications where user_id = $1', [user!.id]);
    expect(left.rows.map((r) => r.token_hash)).toEqual(['ev-hash-1']);
    // Bảng đặt lại mật khẩu không bị ảnh hưởng.
    expect(await store.passwordResets.findUsable('ev-hash-1', now)).toBeNull();

    await store.emailVerifications.insert({ userId: user!.id, tokenHash: 'ev-hash-exp', expiresAt: new Date(now.getTime() - 1000) });
    expect(await store.emailVerifications.deleteExpired(now)).toBeGreaterThanOrEqual(1);
    await pool.query('delete from access.users where id = $1', [user!.id]);
    const cascade = await pool.query('select count(*)::int as n from access.email_verifications where user_id = $1', [user!.id]);
    expect(cascade.rows[0].n).toBe(0);
  });

  it('TF05D: câu backfill trong migration: tài khoản đã liên kết Google thành đã xác thực, tài khoản chỉ có mật khẩu thì không', async () => {
    const sqlFile = fileURLToPath(new URL('../../db/migrations/20261106032708_add_email_verifications/migration.sql', import.meta.url));
    const backfill = readFileSync(sqlFile, 'utf8').split('--> statement-breakpoint').at(-1)!;
    expect(backfill).toMatch(/UPDATE "access"\."users"/);
    const withGoogle = await store.users.insert({ email: 'bf-google@example.com', passwordHash: 'x', displayName: 'G', role: 'member' });
    const onlyPassword = await store.users.insert({ email: 'bf-password@example.com', passwordHash: 'x', displayName: 'P', role: 'member' });
    await store.identities.insert({ provider: 'google', subject: 'bf-sub', userId: withGoogle!.id, email: 'bf-google@example.com' });
    await pool.query(backfill);
    expect((await store.users.findById(withGoogle!.id))?.emailVerifiedAt).toBeInstanceOf(Date);
    expect((await store.users.findById(onlyPassword!.id))?.emailVerifiedAt).toBeNull();
    // Chạy lại không đổi mốc đã có.
    const before = (await store.users.findById(withGoogle!.id))?.emailVerifiedAt?.getTime();
    await pool.query(backfill);
    expect((await store.users.findById(withGoogle!.id))?.emailVerifiedAt?.getTime()).toBe(before);
  });

  it('TF058: ràng buộc database chặn clientId sai dạng và danh sách audience rỗng', async () => {
    await expect(store.serviceClients.insert({ clientId: 'AI Service', secretHash: 'x', allowedAudiences: ['core-api'] })).rejects.toThrow();
    await expect(store.serviceClients.insert({ clientId: 'empty-aud', secretHash: 'x', allowedAudiences: [] })).rejects.toThrow();
  });

  it('TF057: 10 request cùng dùng một token đặt lại mật khẩu: chỉ 1 thành công; token hết hạn không dùng được', async () => {
    const user = await store.users.insert({ email: 'reset-race@example.com', passwordHash: 'x', displayName: 'R', role: 'member' });
    const now = new Date();
    await store.passwordResets.insert({ userId: user!.id, tokenHash: 'hash-race', expiresAt: new Date(now.getTime() + 60_000) });
    expect(await store.passwordResets.findUsable('hash-race', now)).toEqual({ userId: user!.id });

    const results = await Promise.all(Array.from({ length: 10 }, () => store.passwordResets.consume('hash-race', now)));
    expect(results.filter(Boolean)).toEqual([{ userId: user!.id }]);
    expect(await store.passwordResets.findUsable('hash-race', now)).toBeNull();

    await store.passwordResets.insert({ userId: user!.id, tokenHash: 'hash-old', expiresAt: new Date(now.getTime() - 1000) });
    expect(await store.passwordResets.consume('hash-old', now)).toBeNull();
  });

  it('TF057: deleteUnusedByUser giữ token đã dùng; job dọn xoá token đặt lại đã hết hạn', async () => {
    const user = await store.users.insert({ email: 'reset-clean@example.com', passwordHash: 'x', displayName: 'C', role: 'member' });
    const now = new Date();
    const later = new Date(now.getTime() + 60_000);
    await store.passwordResets.insert({ userId: user!.id, tokenHash: 'hash-used', expiresAt: later });
    await store.passwordResets.consume('hash-used', now);
    await store.passwordResets.insert({ userId: user!.id, tokenHash: 'hash-unused', expiresAt: later });
    expect(await store.passwordResets.deleteUnusedByUser(user!.id)).toBe(1);

    await store.passwordResets.insert({ userId: user!.id, tokenHash: 'hash-expired', expiresAt: new Date(now.getTime() - 1000) });
    const result = await runAccessCleanup({ sessions: store.sessions, passwordResets: store.passwordResets, emailVerifications: store.emailVerifications, registrationChallenges: store.registrationChallenges, db, now });
    expect(result.expiredPasswordResets).toBeGreaterThanOrEqual(1);
    const left = await db.select({ tokenHash: passwordResets.tokenHash }).from(passwordResets).where(eq(passwordResets.userId, user!.id));
    expect(left.map((r) => r.tokenHash)).toEqual(['hash-used']);
  });

  it('TF059: tài khoản không có mật khẩu; liên kết Google trùng (provider, subject) trả false; xoá người dùng thì xoá liên kết', async () => {
    const user = await store.users.insert({ email: 'google-only@gmail.com', passwordHash: null, displayName: 'G', role: 'member' });
    expect(user?.passwordHash).toBeNull();
    const identity = { provider: 'google' as const, subject: 'g-sub-1', userId: user!.id, email: 'google-only@gmail.com' };
    expect(await store.identities.insert(identity)).toBe(true);
    expect(await store.identities.insert(identity)).toBe(false);
    expect(await store.identities.findUserId('google', 'g-sub-1')).toBe(user!.id);
    expect(await store.identities.findUserId('google', 'khong-co')).toBeNull();

    await db.delete(users).where(eq(users.id, user!.id));
    expect(await store.identities.findUserId('google', 'g-sub-1')).toBeNull();
  });

  it('email trùng thì insert trả null, không ném lỗi', async () => {
    await store.users.insert({ email: 'dup@example.com', passwordHash: 'x', displayName: 'A', role: 'member' });
    expect(
      await store.users.insert({ email: 'dup@example.com', passwordHash: 'y', displayName: 'B', role: 'member' }),
    ).toBeNull();
  });
});
