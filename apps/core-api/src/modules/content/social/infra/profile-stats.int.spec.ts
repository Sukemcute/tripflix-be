import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createDb, createPool } from '@tripflix/db';
import { migrateModule, startPostgres, type PostgresFixture } from '@tripflix/testing';
import type pg from 'pg';
import { ContentFacade } from '../../content.facade.js';
import { follows, posts } from '../../db/schema/index.js';
import { FollowRepository } from './follow.repository.js';
import { PostRepository } from './post.repository.js';

describe('Số liệu hồ sơ theo lô cho trang quản trị: SQL thật trên PostgreSQL (SCRUM-181)', () => {
  let postgres: PostgresFixture;
  let pool: pg.Pool;
  let facade: ContentFacade;
  const alice = randomUUID();
  const bob = randomUUID();
  const carol = randomUUID();
  const nobody = randomUUID();

  beforeAll(async () => {
    postgres = await startPostgres();
    const url = postgres.buildModuleUrl('content');
    await migrateModule({ url, module: 'content', migrationsFolder: fileURLToPath(new URL('../../db/migrations', import.meta.url)) });
    pool = createPool({ url, max: 2, applicationName: 'profile-stats-int-test' });
    const db = createDb(pool);
    facade = new ContentFacade(new PostRepository(db), new FollowRepository(db));

    // bob và carol theo dõi alice; alice theo dõi bob.
    await db.insert(follows).values([
      { followerId: bob, authorId: alice },
      { followerId: carol, authorId: alice },
      { followerId: alice, authorId: bob },
    ]);
    // alice: 2 bài công khai được tính; bài nháp, bài riêng tư, bài đã xoá không tính.
    await db.insert(posts).values([
      { authorId: alice, postType: 'vlog', title: 'Đà Lạt', status: 'published', visibility: 'public', reactionTotal: 7 },
      { authorId: alice, postType: 'vlog', title: 'Hội An', status: 'published', visibility: 'public', reactionTotal: 5 },
      { authorId: alice, postType: 'vlog', title: 'Nháp', status: 'draft', visibility: 'public', reactionTotal: 100 },
      { authorId: alice, postType: 'vlog', title: 'Riêng', status: 'published', visibility: 'private', reactionTotal: 100 },
      { authorId: alice, postType: 'vlog', title: 'Đã xoá', status: 'published', visibility: 'public', reactionTotal: 100, deletedAt: new Date() },
      { authorId: carol, postType: 'vlog', title: 'Phú Quốc', status: 'published', visibility: 'public', reactionTotal: 0 },
    ]);
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    await postgres?.stop();
  });

  it('đếm người theo dõi, đang theo dõi, bài công khai và lượt thích nhận được của nhiều người một lần', async () => {
    const stats = await facade.getProfileStats([alice, bob, carol]);

    expect(stats.get(alice)).toEqual({ followerCount: 2, followingCount: 1, likeCount: 12, postCount: 2 });
    expect(stats.get(bob)).toEqual({ followerCount: 1, followingCount: 1, likeCount: 0, postCount: 0 });
    expect(stats.get(carol)).toEqual({ followerCount: 0, followingCount: 1, likeCount: 0, postCount: 1 });
  });

  it('người chưa có gì vẫn có mặt với toàn số 0; id viết hoa vẫn khớp; danh sách rỗng không truy vấn', async () => {
    const stats = await facade.getProfileStats([nobody, alice.toUpperCase()]);

    expect(stats.get(nobody)).toEqual({ followerCount: 0, followingCount: 0, likeCount: 0, postCount: 0 });
    expect(stats.get(alice)).toMatchObject({ followerCount: 2, postCount: 2 });
    expect((await facade.getProfileStats([])).size).toBe(0);
  });
});
