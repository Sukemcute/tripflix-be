import 'reflect-metadata';
import { fileURLToPath } from 'node:url';
import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MemorySidBlocklist } from '@tripflix/auth';
import {
  MODULES,
  buildDrizzleToken,
  buildTransactionHostToken,
  createDb,
  createPool,
  createTransactionalPlugins,
  type Db,
  type ModuleTransactionHost,
} from '@tripflix/db';
import { RedisStreamsEventBus, STREAMS } from '@tripflix/event-bus';
import { DrizzleOutboxStore, OutboxRelay, deletePublishedBefore } from '@tripflix/outbox';
import { migrateModule, startPostgres, startRedis, type PostgresFixture, type RedisFixture } from '@tripflix/testing';
import { Redis } from 'ioredis';
import { ClsModule } from 'nestjs-cls';
import type pg from 'pg';
import { CORE_ENV } from '../../../../platform/tokens.js';
import { EmailVerificationUseCases } from '../../account/application/email-verification.use-cases.js';
import { INVALID_VERIFY_TOKEN_MESSAGE } from '../../account/domain/email-verification.js';
import { accessOutboxEvents } from '../../db/schema/index.js';
import { MemoryActionRateLimiter } from '../infra/memory/memory-action-rate-limiter.js';
import { DrizzleAccessStore } from '../infra/drizzle-access.store.js';
import { MemoryLoginRateLimiter } from '../infra/memory/memory-login-rate-limiter.js';
import { AuthUseCases } from './auth.use-cases.js';
import {
  ACCESS_SID_BLOCKLIST,
  ACCESS_STORE,
  ACTION_RATE_LIMITER,
  CLOCK,
  GOOGLE_VERIFIER,
  LOGIN_RATE_LIMITER,
  PASSWORD_HASHER,
  TOKEN_ISSUER,
  type AccessStore,
} from './ports.js';

const meta = { ip: '10.0.0.1', userAgent: 'int-test' };

/**
 * @Transactional('access') trên Postgres thật: user, audit, outbox cùng commit hoặc cùng rollback;
 * relay đưa sự kiện từ access.outbox_events sang Redis Streams.
 */
describe('AuthUseCases + @Transactional trên Postgres, Redis thật', () => {
  let postgres: PostgresFixture;
  let redisFixture: RedisFixture;
  let pool: pg.Pool;
  let db: Db;
  let redis: Redis;
  let failingOutbox = false;
  let verification: EmailVerificationUseCases;

  async function createUseCases() {
    @Global()
    @Module({
      providers: MODULES.map((m) => ({ provide: buildDrizzleToken(m), useValue: db })),
      exports: MODULES.map((m) => buildDrizzleToken(m)),
    })
    class RealDrizzleModule {}

    const moduleRef = await Test.createTestingModule({
      imports: [
        RealDrizzleModule,
        ClsModule.forRoot({ global: true, plugins: createTransactionalPlugins([RealDrizzleModule]) }),
      ],
      providers: [
        AuthUseCases,
        EmailVerificationUseCases,
        { provide: ACTION_RATE_LIMITER, useValue: new MemoryActionRateLimiter() },
        { provide: CORE_ENV, useValue: {} },
        {
          provide: ACCESS_STORE,
          inject: [buildTransactionHostToken('access')],
          useFactory: (txHost: ModuleTransactionHost): AccessStore => {
            const store = new DrizzleAccessStore(() => txHost.tx);
            // Giả lỗi ở bước ghi outbox để kiểm rollback cả user và audit.
            const add = store.outbox.add.bind(store.outbox);
            store.outbox.add = async (event) => {
              if (failingOutbox) throw new Error('outbox lỗi giả');
              return add(event);
            };
            return store;
          },
        },
        { provide: PASSWORD_HASHER, useValue: { hash: async (p: string) => `h:${p}`, verify: async (hash: string, plain: string) => hash === `h:${plain}` } },
        { provide: TOKEN_ISSUER, useValue: { issue: async () => ({ token: 't', expiresIn: 900 }), getJwks: () => ({ keys: [] }) } },
        { provide: LOGIN_RATE_LIMITER, useValue: new MemoryLoginRateLimiter() },
        { provide: ACCESS_SID_BLOCKLIST, useValue: new MemorySidBlocklist() },
        { provide: CLOCK, useValue: () => new Date() },
        { provide: GOOGLE_VERIFIER, useValue: { verify: async () => Promise.reject(new Error('không dùng trong test này')) } },
      ],
    }).compile();
    await moduleRef.init();
    verification = moduleRef.get(EmailVerificationUseCases);
    return moduleRef.get(AuthUseCases);
  }

  async function countRows(table: string, email: string) {
    const column = table === 'users' ? 'email' : table === 'audit_logs' ? "meta->>'email'" : "payload->>'displayName'";
    const result = await pool.query(`select count(*)::int as n from access.${table} where ${column} = $1`, [email]);
    return result.rows[0].n as number;
  }

  beforeAll(async () => {
    [postgres, redisFixture] = await Promise.all([startPostgres(), startRedis()]);
    const url = postgres.buildModuleUrl('access');
    await migrateModule({ url, module: 'access', migrationsFolder: fileURLToPath(new URL('../../db/migrations', import.meta.url)) });
    pool = createPool({ url, max: 5, applicationName: 'access-tx-int-test' });
    db = createDb(pool);
    redis = new Redis(redisFixture.url);
  });

  afterAll(async () => {
    redis?.disconnect();
    await pool?.end();
    await Promise.all([postgres?.stop(), redisFixture?.stop()]);
  });

  async function prepareSignup(auth: AuthUseCases, email: string, displayName = email) {
    const registrationId = await auth.requestRegistrationCode(email, meta);
    const result = await pool.query(
      "select payload->>'code' as code from access.outbox_events where type = 'access.registration_code_requested' and user_id = $1",
      [registrationId],
    );
    return { email, password: 'mot-mat-khau-an-toan', displayName, registrationId, code: result.rows[0].code as string };
  }

  async function seedLegacyUser(email: string, displayName: string) {
    const store = new DrizzleAccessStore(() => db);
    const user = (await store.users.insert({ email, displayName, role: 'member', passwordHash: 'h:legacy' }))!;
    await verification.resend(user.id, meta);
    return user;
  }

  it('đăng ký: user và sự kiện outbox cùng được commit', async () => {
    failingOutbox = false;
    const auth = await createUseCases();
    const user = await auth.register(await prepareSignup(auth, 'commit@example.com'), meta);
    expect(user.email).toBe('commit@example.com');
    expect(await countRows('users', 'commit@example.com')).toBe(1);
    // access.user.registered và access.user.welcome_email_requested, cùng commit với user.
    expect(await countRows('outbox_events', 'commit@example.com')).toBe(2);
  });

  it('ghi outbox lỗi thì rollback cả user: không có người dùng nửa vời', async () => {
    const auth = await createUseCases();
    const signup = await prepareSignup(auth, 'rollback@example.com');
    failingOutbox = true;
    await expect(
      auth.register(signup, meta),
    ).rejects.toThrow('outbox lỗi giả');
    expect(await countRows('users', 'rollback@example.com')).toBe(0);
    expect(await countRows('outbox_events', 'rollback@example.com')).toBe(0);
    failingOutbox = false;
  });

  it('chỉ một yêu cầu đồng thời dùng được mã đăng ký', async () => {
    const auth = await createUseCases();
    const signup = await prepareSignup(auth, 'otp-race@example.com');
    const results = await Promise.allSettled([auth.register(signup, meta), auth.register(signup, meta)]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await countRows('users', signup.email)).toBe(1);
  });

  it('relay đưa sự kiện đã commit sang stream:core.access rồi đánh dấu đã gửi', async () => {
    const relay = new OutboxRelay({
      store: new DrizzleOutboxStore(db, accessOutboxEvents),
      bus: new RedisStreamsEventBus(redis),
      stream: STREAMS.access,
    });
    const result = await relay.publishPending();
    expect(result.publishedCount).toBeGreaterThanOrEqual(1);
    expect(result.failedCount).toBe(0);

    const entries = await redis.xrange(STREAMS.access, '-', '+');
    const events = entries.map(([, fields]) => JSON.parse(fields[1]!) as { type: string; payload: { displayName: string } });
    expect(events.some((e) => e.type === 'access.user.registered' && e.payload.displayName === 'commit@example.com')).toBe(true);

    const pending = await pool.query('select count(*)::int as n from access.outbox_events where published_at is null');
    expect(pending.rows[0].n).toBe(0);
  });

  it('deletePublishedBefore chỉ xoá dòng đã gửi trước mốc', async () => {
    failingOutbox = false;
    const auth = await createUseCases();
    await auth.register(await prepareSignup(auth, 'unsent@example.com'), meta);
    expect(await deletePublishedBefore(db, accessOutboxEvents, new Date(Date.now() - 60_000))).toBe(0);
    expect(await deletePublishedBefore(db, accessOutboxEvents, new Date(Date.now() + 60_000))).toBeGreaterThanOrEqual(1);
    // Sự kiện chưa gửi vẫn còn (registered và welcome_email_requested).
    expect(await countRows('outbox_events', 'unsent@example.com')).toBe(2);
  });

  /** Token gốc trong link của sự kiện xác thực email mới nhất (outbox thật). */
  async function latestVerifyToken(email: string): Promise<string> {
    const result = await pool.query(
      `select payload->>'verifyUrl' as url from access.outbox_events
       where type = 'access.email_verification_requested' and payload->>'email' = $1 order by occurred_at desc limit 1`,
      [email],
    );
    return new URL(result.rows[0].url as string).searchParams.get('token')!;
  }

  it('TF05D: xác thực email trên Postgres thật; tài khoản bị khoá thì rollback, link chưa bị tiêu', async () => {
    failingOutbox = false;
    await createUseCases();
    const user = await seedLegacyUser('verify-tx@example.com', 'V');
    const token = await latestVerifyToken('verify-tx@example.com');
    const verifiedAt = async () =>
      (await pool.query('select email_verified_at from access.users where id = $1', [user.id])).rows[0].email_verified_at as Date | null;
    const usedTokens = async () =>
      (await pool.query('select count(*)::int as n from access.email_verifications where user_id = $1 and used_at is not null', [user.id])).rows[0]
        .n as number;

    await pool.query(`update access.users set status = 'locked' where id = $1`, [user.id]);
    await expect(verification.verify({ token }, meta)).rejects.toThrow(INVALID_VERIFY_TOKEN_MESSAGE);
    expect(await verifiedAt()).toBeNull();
    expect(await usedTokens()).toBe(0);

    await pool.query(`update access.users set status = 'active' where id = $1`, [user.id]);
    await verification.verify({ token }, meta);
    expect(await verifiedAt()).toBeInstanceOf(Date);
    expect(await usedTokens()).toBe(1);
    await expect(verification.verify({ token }, meta)).rejects.toThrow(INVALID_VERIFY_TOKEN_MESSAGE);
  });

  it('TF05D: 10 request cùng bấm một link: chỉ 1 thành công', async () => {
    await createUseCases();
    await seedLegacyUser('verify-race@example.com', 'R');
    const token = await latestVerifyToken('verify-race@example.com');
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => verification.verify({ token }, meta)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('TF05D: gửi lại đồng thời chỉ giữ một liên kết chưa dùng', async () => {
    await createUseCases();
    const email = 'resend-race@example.com';
    const user = await seedLegacyUser(email, 'R');
    const original = await latestVerifyToken(email);

    await expect(Promise.all([verification.resend(user.id, meta), verification.resend(user.id, meta)]))
      .resolves.toEqual(['sent', 'sent']);
    const pending = await pool.query(
      'select count(*)::int as n from access.email_verifications where user_id = $1 and used_at is null',
      [user.id],
    );
    expect(pending.rows[0].n).toBe(1);
    await expect(verification.verify({ token: original }, meta)).rejects.toThrow(INVALID_VERIFY_TOKEN_MESSAGE);
  });
});
