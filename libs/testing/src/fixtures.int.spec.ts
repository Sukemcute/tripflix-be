import { Redis } from 'ioredis';
import pg from 'pg';
import { startPostgres, type PostgresFixture } from './postgres.js';
import { startRedis, type RedisFixture } from './redis.js';

async function queryAs(url: string, sql: string) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await client.query(sql);
  } finally {
    await client.end();
  }
}

describe('libs/testing: Postgres, Redis thật', () => {
  let postgres: PostgresFixture;
  let redis: RedisFixture;

  beforeAll(async () => {
    [postgres, redis] = await Promise.all([startPostgres(), startRedis()]);
  });

  afterAll(async () => {
    await Promise.all([postgres?.stop(), redis?.stop()]);
  });

  it('chạy deploy/postgres/init: đủ database, schema và extension', async () => {
    const dbs = await queryAs(postgres.buildAdminUrl('core'), 'select datname from pg_database order by 1');
    const names = dbs.rows.map((r) => r.datname);
    expect(names).toEqual(expect.arrayContaining(['core', 'notification']));
    expect(names).not.toContain('commerce');
    const schemas = await queryAs(
      postgres.buildAdminUrl('core'),
      "select nspname from pg_namespace where nspname in ('access','content','discovery','analytics','commerce') order by 1",
    );
    expect(schemas.rows.map((r) => r.nspname)).toEqual(['access', 'analytics', 'commerce', 'content', 'discovery']);
    const ext = await queryAs(postgres.buildAdminUrl('core'), "select extname from pg_extension where extname = 'vector'");
    expect(ext.rowCount).toBe(1);
  });

  it('user của module chỉ dùng được schema của mình', async () => {
    await expect(queryAs(postgres.buildModuleUrl('access'), 'create table access.t1 (id int)')).resolves.toBeDefined();
    await expect(queryAs(postgres.buildModuleUrl('access'), 'create table content.t1 (id int)')).rejects.toThrow(
      /permission denied/,
    );
    // commerce ở chung database core nhưng vẫn cách ly theo schema, theo cả hai chiều.
    await expect(queryAs(postgres.buildModuleUrl('commerce'), 'create table commerce.t1 (id int)')).resolves.toBeDefined();
    await expect(queryAs(postgres.buildModuleUrl('access'), 'select * from commerce.t1')).rejects.toThrow(
      /permission denied/,
    );
    await expect(queryAs(postgres.buildModuleUrl('access'), 'create table commerce.t2 (id int)')).rejects.toThrow(
      /permission denied/,
    );
    await expect(queryAs(postgres.buildModuleUrl('commerce'), 'select * from access.t1')).rejects.toThrow(
      /permission denied/,
    );
  });

  it('Redis trả lời được', async () => {
    const client = new Redis(redis.url);
    try {
      expect(await client.ping()).toBe('PONG');
    } finally {
      client.disconnect();
    }
  });
});
