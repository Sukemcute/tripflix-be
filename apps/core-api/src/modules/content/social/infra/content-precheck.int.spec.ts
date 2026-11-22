import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createDb, createPool } from '@tripflix/db';
import { migrateModule, startPostgres, type PostgresFixture } from '@tripflix/testing';
import type pg from 'pg';
import { posts } from '../../db/schema/index.js';
import { assertPrecheckedPost } from '../application/common/content-precheck.js';
import { PostRepository } from './post.repository.js';

/**
 * Bộ đếm tương tác thật ghi updatedAt mới. Bản đã kiểm luật vẫn phải được coi là chưa đổi khi
 * chỉ bộ đếm đổi, để tác giả sửa bài không bị 409 oan; sửa nội dung thì vẫn bị chặn (TF91).
 */
describe('assertPrecheckedPost trên Postgres thật (TF91)', () => {
  let postgres: PostgresFixture;
  let pool: pg.Pool;
  let repository: PostRepository;
  let db: ReturnType<typeof createDb>;

  beforeAll(async () => {
    postgres = await startPostgres();
    const url = postgres.buildModuleUrl('content');
    await migrateModule({
      url,
      module: 'content',
      migrationsFolder: fileURLToPath(new URL('../../db/migrations', import.meta.url)),
    });
    pool = createPool({ url, max: 2, applicationName: 'content-precheck-int-test' });
    db = createDb(pool);
    repository = new PostRepository(db);
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await postgres?.stop();
  });

  async function insertPublishedPost() {
    const [post] = await db
      .insert(posts)
      .values({
        authorId: randomUUID(),
        postType: 'vlog',
        title: 'Đà Lạt 3 ngày',
        body: 'Lịch trình',
        hashtags: ['dalat'],
        status: 'published',
        publishedAt: new Date(),
        updatedAt: new Date('2026-11-16T00:00:00Z'),
        tripAttachment: { hotelName: 'Homestay đồi thông', daysCount: 3 },
      })
      .returning();
    return post!;
  }

  it('thả tim, bình luận, chia sẻ, lưu bài đổi updatedAt nhưng không làm bản đã kiểm hết hiệu lực', async () => {
    const checked = await insertPublishedPost();

    await repository.incrementCounter(checked.id, 'commentCount', 1);
    await repository.incrementCounter(checked.id, 'shareCount', 1);
    await repository.incrementCounter(checked.id, 'bookmarkCount', 1);
    await repository.updateReactionCounts(checked.id, { like: 1 }, 1);
    const current = (await repository.findById(checked.id))!;

    expect(current.updatedAt.getTime()).not.toBe(checked.updatedAt.getTime());
    expect(current.commentCount).toBe(1);
    expect(() => assertPrecheckedPost(current, checked)).not.toThrow();
  });

  it('nội dung bị sửa ở phiên khác thì vẫn báo 409', async () => {
    const checked = await insertPublishedPost();

    await repository.update(checked.id, { body: 'Bản sửa ở phiên khác' });
    const current = (await repository.findById(checked.id))!;

    expect(() => assertPrecheckedPost(current, checked)).toThrow(/vừa thay đổi/);
  });
});
