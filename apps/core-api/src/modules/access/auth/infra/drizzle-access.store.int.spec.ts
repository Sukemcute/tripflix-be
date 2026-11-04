import { fileURLToPath } from 'node:url';
import { createDb, createPool } from '@tripflix/db';
import { migrateModule, startPostgres, type PostgresFixture } from '@tripflix/testing';
import type pg from 'pg';
import { hashRefreshToken } from '../application/refresh-token.js';
import { DrizzleAccessStore } from './drizzle-access.store.js';

// docs/architecture/11 §6: xoay vòng refresh token phải đúng trên Postgres thật, kể cả khi nhiều request cùng lúc.
describe('DrizzleAccessStore trên Postgres thật (user tf_access)', () => {
  let postgres: PostgresFixture;
  let pool: pg.Pool;
  let store: DrizzleAccessStore;

  beforeAll(async () => {
    postgres = await startPostgres();
    const url = postgres.buildModuleUrl('access');
    await migrateModule({
      url,
      module: 'access',
      migrationsFolder: fileURLToPath(new URL('../../db/migrations', import.meta.url)),
    });
    pool = createPool({ url, max: 10, applicationName: 'access-int-test' });
    const db = createDb(pool);
    store = new DrizzleAccessStore(() => db);
  });

  afterAll(async () => {
    await pool?.end();
    await postgres?.stop();
  });

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

  it('email trùng thì insert trả null, không ném lỗi', async () => {
    await store.users.insert({ email: 'dup@example.com', passwordHash: 'x', displayName: 'A', role: 'member' });
    expect(
      await store.users.insert({ email: 'dup@example.com', passwordHash: 'y', displayName: 'B', role: 'member' }),
    ).toBeNull();
  });
});
