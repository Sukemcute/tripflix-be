import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createDb, createPool } from '@tripflix/db';
import { migrateModule, startPostgres, type PostgresFixture } from '@tripflix/testing';
import type pg from 'pg';
import { follows } from '../../db/schema/index.js';
import { FollowRepository } from './follow.repository.js';

describe('FollowRepository trên PostgreSQL', () => {
  let fixture: PostgresFixture;
  let pool: pg.Pool;

  beforeAll(async () => {
    fixture = await startPostgres();
    const url = fixture.buildModuleUrl('content');
    await migrateModule({ url, module: 'content', migrationsFolder: fileURLToPath(new URL('../../db/migrations', import.meta.url)) });
    pool = createPool({ url, max: 2, applicationName: 'follows-test' });
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    await fixture?.stop();
  });

  it('phân trang follower đủ điều kiện, bỏ lượt follow muộn và lượt đã hủy', async () => {
    const db = createDb(pool);
    const repository = new FollowRepository(db);
    const authorId = randomUUID();
    const publishedAt = new Date('2026-11-12T09:00:00Z');
    const eligible = Array.from({ length: 201 }, () => randomUUID()).sort();
    await db.insert(follows).values(eligible.map((followerId) => ({
      followerId, authorId, followedAt: new Date('2026-11-12T08:00:00Z'),
    })));
    const late = randomUUID();
    await repository.follow(late, authorId);
    await repository.follow(late, authorId);
    expect(await repository.isFollowing(late, authorId)).toBe(true);
    const first = await repository.listEligible(authorId, publishedAt);
    expect(first).toEqual({ recipients: eligible.slice(0, 200), nextCursor: eligible[199] });
    await repository.unfollow(eligible[200]!, authorId);
    expect(await repository.listEligible(authorId, publishedAt, first.nextCursor!)).toEqual({
      recipients: [], nextCursor: null,
    });
    await repository.unfollow(late, authorId);
    await repository.unfollow(late, authorId);
    expect(await repository.isFollowing(late, authorId)).toBe(false);
  });
});
