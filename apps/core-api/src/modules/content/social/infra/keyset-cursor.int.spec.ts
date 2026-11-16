import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createDb, createPool } from '@tripflix/db';
import { migrateModule, startPostgres, type PostgresFixture } from '@tripflix/testing';
import type pg from 'pg';
import { posts } from '../../db/schema/index.js';
import { decodeCursor, decodeSyncCursor, encodeCursor, encodeSyncCursor } from '../application/common/cursor.js';
import { BookmarkRepository } from './bookmark.repository.js';
import { CommentRepository } from './comment.repository.js';
import { PostRepository } from './post.repository.js';

/** Cùng một mili giây, khác micro giây: như khi nhiều người gửi cùng lúc. Cursor chỉ giữ mili giây. */
const SAME_MS = ['100', '200', '300', '400', '500'].map((us) => `2026-11-16 08:00:00.048${us}+00`);

/** Đi hết các trang như web bấm "Xem thêm": cursor qua đúng encode/decode thật. */
async function walk<T extends { id: string }>(
  fetchPage: (cursor: { createdAt: Date; id: string } | undefined) => Promise<T[]>,
  cursorOf: (row: T) => string,
  decode: (cursor: string) => { createdAt: Date; id: string } | undefined,
): Promise<string[]> {
  const seen: string[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 10; page += 1) {
    const rows = await fetchPage(cursor ? decode(cursor) : undefined);
    const pageRows = rows.slice(0, 2);
    seen.push(...pageRows.map((row) => row.id));
    if (rows.length <= 2) break;
    cursor = cursorOf(pageRows[pageRows.length - 1]!);
  }
  return seen;
}

describe('Cursor phân trang không bỏ sót dòng cùng mili giây', () => {
  let postgres: PostgresFixture;
  let pool: pg.Pool;
  let db: ReturnType<typeof createDb>;

  beforeAll(async () => {
    postgres = await startPostgres();
    const url = postgres.buildModuleUrl('content');
    await migrateModule({
      url,
      module: 'content',
      migrationsFolder: fileURLToPath(new URL('../../db/migrations', import.meta.url)),
    });
    pool = createPool({ url, max: 2, applicationName: 'keyset-cursor-int-test' });
    db = createDb(pool);
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    await postgres?.stop();
  });

  it('bình luận gốc: đủ 5 bình luận, đúng thứ tự mới trước', async () => {
    const authorId = randomUUID();
    const [post] = await db.insert(posts).values({ authorId, postType: 'vlog', title: 'Bài thử' }).returning();
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO content.comments (post_id, author_id, body, created_at)
       SELECT $1, $2, 'cùng mili giây', t::timestamptz FROM unnest($3::text[]) AS t RETURNING id`,
      [post!.id, authorId, SAME_MS],
    );
    const repository = new CommentRepository(db);

    const seen = await walk(
      (cursor) => repository.findByPostId({ postId: post!.id, limit: 3, cursorCreatedAt: cursor?.createdAt, cursorId: cursor?.id }),
      (row) => encodeCursor(row.createdAt, row.id),
      decodeCursor,
    );

    expect(seen).toEqual(rows.map((row) => row.id).reverse());
  });

  it('bài công khai, bài của một người, bài trong trang admin: đủ 5 bài', async () => {
    const authorId = randomUUID();
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO content.posts (author_id, post_type, title, status, visibility, created_at)
       SELECT $1, 'vlog', 'cùng mili giây', 'published', 'public', t::timestamptz FROM unnest($2::text[]) AS t RETURNING id`,
      [authorId, SAME_MS],
    );
    const expected = rows.map((row) => row.id).reverse();
    const repository = new PostRepository(db);
    const page = (cursor?: { createdAt: Date; id: string }) => ({ limit: 3, cursorCreatedAt: cursor?.createdAt, cursorId: cursor?.id });
    const cursorOf = (row: { createdAt: Date; id: string }) => encodeCursor(row.createdAt, row.id);

    expect(await walk((cursor) => repository.findPublicPosts({ ...page(cursor), authorId }), cursorOf, decodeCursor)).toEqual(expected);
    expect(await walk((cursor) => repository.findUserPosts({ ...page(cursor), authorId }), cursorOf, decodeCursor)).toEqual(expected);
    expect(await walk((cursor) => repository.findAdminPosts({ ...page(cursor), authorId }), cursorOf, decodeCursor)).toEqual(expected);
  });

  it('bài đã lưu: đủ 5 bookmark', async () => {
    const userId = randomUUID();
    const { rows: postRows } = await pool.query<{ id: string }>(
      `INSERT INTO content.posts (author_id, post_type, title, status, visibility)
       SELECT $1, 'vlog', 'bài ' || n, 'published', 'public' FROM generate_series(1, 5) AS n RETURNING id`,
      [randomUUID()],
    );
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO content.bookmarks (post_id, user_id, created_at)
       SELECT p, $1, t::timestamptz FROM unnest($2::uuid[], $3::text[]) AS x(p, t) RETURNING id`,
      [userId, postRows.map((row) => row.id), SAME_MS],
    );
    const repository = new BookmarkRepository(db);

    const seen = await walk(
      (cursor) => repository.findUserBookmarks({ userId, limit: 3, cursorCreatedAt: cursor?.createdAt, cursorId: cursor?.id }),
      (row) => encodeCursor(row.createdAt, row.id),
      decodeCursor,
    );

    expect(seen).toEqual(rows.map((row) => row.id).reverse());
  });

  it('đồng bộ theo updatedAt (tăng dần): đủ 5 bài', async () => {
    const authorId = randomUUID();
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO content.posts (author_id, post_type, title, status, visibility, updated_at)
       SELECT $1, 'vlog', 'cùng mili giây', 'published', 'public', t::timestamptz FROM unnest($2::text[]) AS t RETURNING id`,
      [authorId, SAME_MS],
    );
    const ids = new Set(rows.map((row) => row.id));
    const repository = new PostRepository(db);

    const seen = await walk(
      async (cursor) =>
        (await repository.findPostsForSync({
          limit: 1000,
          updatedAfter: new Date('2026-11-16T08:00:00.000Z'),
          cursorUpdatedAt: cursor?.createdAt,
          cursorId: cursor?.id,
        }))
          .filter((row) => ids.has(row.id))
          .slice(0, 3),
      (row) => encodeSyncCursor(row.updatedAt, row.id),
      (cursor) => {
        const decoded = decodeSyncCursor(cursor);
        return decoded && { createdAt: decoded.updatedAt, id: decoded.id };
      },
    );

    expect(seen).toEqual(rows.map((row) => row.id));
  });

  it('dòng của cursor đã đổi thời gian (bài vừa sửa): vẫn dùng thời gian trong cursor, không nhảy cóc', async () => {
    const authorId = randomUUID();
    const { rows } = await pool.query<{ id: string; updated_at: Date }>(
      `INSERT INTO content.posts (author_id, post_type, title, status, visibility, updated_at)
       SELECT $1, 'vlog', 'bài ' || n, 'published', 'public', '2026-11-16 09:00:00+00'::timestamptz + n * interval '1 second'
       FROM generate_series(1, 3) AS n RETURNING id, updated_at`,
      [authorId],
    );
    const [first, second, third] = rows;
    const cursor = { updatedAt: first!.updated_at, id: first!.id };
    // Bài làm cursor được sửa sau khi trang trước đã trả về: updated_at nhảy về sau bài thứ ba.
    await pool.query(`UPDATE content.posts SET updated_at = '2026-11-16 10:00:00+00' WHERE id = $1`, [first!.id]);
    const repository = new PostRepository(db);

    const next = await repository.findPostsForSync({
      limit: 1000,
      updatedAfter: new Date('2026-11-16T09:00:00.000Z'),
      cursorUpdatedAt: cursor.updatedAt,
      cursorId: cursor.id,
    });

    expect(next.map((row) => row.id).filter((id) => id !== first!.id).slice(0, 2)).toEqual([second!.id, third!.id]);
  });
});
