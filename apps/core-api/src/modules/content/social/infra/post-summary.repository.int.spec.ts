import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createDb, createPool } from '@tripflix/db';
import { migrateModule, startPostgres, type PostgresFixture } from '@tripflix/testing';
import type pg from 'pg';
import { comments, posts } from '../../db/schema/index.js';
import { PostSummaryRepository } from './post-summary.repository.js';

describe('PostSummaryRepository.markChecked', () => {
  let postgres: PostgresFixture;
  let pool: pg.Pool;
  let repository: PostSummaryRepository;
  let db: ReturnType<typeof createDb>;

  const generatedAt = new Date('2026-11-13T04:00:00Z');
  const later = (minutes: number) => new Date(generatedAt.getTime() + minutes * 60_000);

  beforeAll(async () => {
    postgres = await startPostgres();
    const url = postgres.buildModuleUrl('content');
    await migrateModule({
      url,
      module: 'content',
      migrationsFolder: fileURLToPath(new URL('../../db/migrations', import.meta.url)),
    });
    pool = createPool({ url, max: 2, applicationName: 'post-summary-repository-int-test' });
    db = createDb(pool);
    repository = new PostSummaryRepository(db);
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    await postgres?.stop();
  });

  async function createSummary(inputHash = 'hash-1') {
    const [post] = await db
      .insert(posts)
      .values({ authorId: randomUUID(), postType: 'vlog', title: 'Bài có tóm tắt' })
      .returning();
    await repository.saveIfNewer({
      postId: post!.id,
      status: 'ready',
      summary: 'Tóm tắt',
      inputHash,
      commentCountAtSummary: 5,
      generatedAt,
    });
    return post!.id;
  }

  it('ghi mốc kiểm và số bình luận khi inputHash khớp, không đụng nội dung', async () => {
    const postId = await createSummary();

    const updated = await repository.markChecked({ postId, inputHash: 'hash-1', checkedAt: later(10), commentCount: 7 });

    const row = await repository.findByPostId(postId);
    expect(updated).toBe(true);
    expect(row?.checkedAt?.toISOString()).toBe(later(10).toISOString());
    expect(row?.commentCountAtSummary).toBe(7);
    expect(row?.summary).toBe('Tóm tắt');
    expect(row?.generatedAt?.toISOString()).toBe(generatedAt.toISOString());
  });

  it('bỏ qua khi inputHash khác bản đang lưu (đã có bản tóm tắt mới hơn)', async () => {
    const postId = await createSummary('hash-new');

    const updated = await repository.markChecked({ postId, inputHash: 'hash-old', checkedAt: later(10), commentCount: 7 });

    expect(updated).toBe(false);
    expect((await repository.findByPostId(postId))?.checkedAt).toBeNull();
  });

  it('chỉ tiến mốc lên: lệnh kiểm đến trễ không lùi checkedAt, mốc trước generatedAt bị bỏ', async () => {
    const postId = await createSummary();
    await repository.markChecked({ postId, inputHash: 'hash-1', checkedAt: later(20), commentCount: 9 });

    const late = await repository.markChecked({ postId, inputHash: 'hash-1', checkedAt: later(5), commentCount: 6 });
    const beforeSummary = await repository.markChecked({ postId, inputHash: 'hash-1', checkedAt: later(-5), commentCount: 4 });

    const row = await repository.findByPostId(postId);
    expect(late).toBe(false);
    expect(beforeSummary).toBe(false);
    expect(row?.checkedAt?.toISOString()).toBe(later(20).toISOString());
    expect(row?.commentCountAtSummary).toBe(9);
  });

  it('lưu bản tóm tắt mới thì xoá mốc kiểm của bản cũ', async () => {
    const postId = await createSummary();
    await repository.markChecked({ postId, inputHash: 'hash-1', checkedAt: later(10), commentCount: 7 });

    await repository.saveIfNewer({
      postId,
      status: 'ready',
      summary: 'Tóm tắt mới',
      inputHash: 'hash-2',
      commentCountAtSummary: 8,
      generatedAt: later(30),
    });

    const row = await repository.findByPostId(postId);
    expect(row?.summary).toBe('Tóm tắt mới');
    expect(row?.checkedAt).toBeNull();
  });

  it('không có bản tóm tắt nào thì trả false', async () => {
    const updated = await repository.markChecked({
      postId: randomUUID(),
      inputHash: 'hash-1',
      checkedAt: later(10),
      commentCount: 1,
    });
    expect(updated).toBe(false);
  });

  it('đối soát không lỗi khi sourceCommentIds có id không phải UUID (dữ liệu cũ), coi id đó là nguồn đã mất', async () => {
    const postId = await createSummary('hash-held');
    const cleanPostId = await createSummary('hash-clean');
    const [visible] = await db
      .insert(comments)
      .values({ postId: cleanPostId, authorId: randomUUID(), body: 'Bình luận còn hiện' })
      .returning();
    // Ghi thẳng bằng SQL: API lưu tóm tắt đã kiểm UUID, chỉ dòng cũ mới có id lạ.
    await pool.query('UPDATE content.post_summaries SET source_comment_ids = $2::jsonb WHERE post_id = $1', [
      postId,
      JSON.stringify(['khong-phai-uuid', visible!.id]),
    ]);
    await pool.query('UPDATE content.post_summaries SET source_comment_ids = $2::jsonb WHERE post_id = $1', [
      cleanPostId,
      JSON.stringify([visible!.id]),
    ]);

    const { postIds } = await repository.findHeldSummaryPostIds({ limit: 200 });

    expect(postIds).toContain(postId);
    expect(postIds).not.toContain(cleanPostId);
  });
});
