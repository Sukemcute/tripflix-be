import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createPool } from '@tripflix/db';
import { migrateModule, startPostgres, type PostgresFixture } from '@tripflix/testing';
import type pg from 'pg';

const MIGRATIONS_FOLDER = fileURLToPath(new URL('./migrations', import.meta.url));
const CLEANUP_SQL = readFileSync(
  fileURLToPath(new URL('./migrations/20261116034606_vlog_video_cleanup/migration.sql', import.meta.url)),
  'utf8',
);

const AUTHOR_ID = '11111111-1111-4111-8111-111111111111';
const VIDEO_A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const VIDEO_B = 'aaaaaaaa-0000-4000-8000-00000000000b';
const IMAGE_A = 'bbbbbbbb-0000-4000-8000-00000000000a';
const IMAGE_B = 'bbbbbbbb-0000-4000-8000-00000000000b';
const UNKNOWN_ID = 'cccccccc-0000-4000-8000-00000000000c';

interface PostRow {
  post_type: string;
  media_ids: unknown;
  cover_media_id: string | null;
}

/** Migration vlog_video_cleanup trên Postgres thật: gỡ video khỏi bài viết cũ, không đụng Reels và ảnh. */
describe('Dọn bài viết cũ kèm video (Postgres thật)', () => {
  let postgres: PostgresFixture;
  let pool: pg.Pool;

  beforeAll(async () => {
    postgres = await startPostgres();
    const url = postgres.buildModuleUrl('content');
    await migrateModule({ url, module: 'content', migrationsFolder: MIGRATIONS_FOLDER });
    pool = createPool({ url, max: 2, applicationName: 'vlog-video-cleanup-int-test' });

    await pool.query(
      `insert into content.media_assets (id, owner_id, kind, mime_type, file_size_bytes, source_key, status, duration_sec, hls_prefix, aspect)
       values ($1, $5, 'video', 'video/mp4', 100, 'v/a', 'ready', 30, 'videos/a/r1', '9:16'),
              ($2, $5, 'video', 'video/mp4', 100, 'v/b', 'failed', 30, null, null),
              ($3, $5, 'image', 'image/jpeg', 100, 'i/a', 'ready', null, null, null),
              ($4, $5, 'image', 'image/png', 100, 'i/b', 'ready', null, null, null)`,
      [VIDEO_A, VIDEO_B, IMAGE_A, IMAGE_B, AUTHOR_ID],
    );
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    await postgres?.stop();
  });

  async function insertPost(
    postType: string,
    status: string,
    mediaIds: unknown,
    coverMediaId: string | null,
  ): Promise<string> {
    const { rows } = await pool.query<{ id: string }>(
      `insert into content.posts (id, author_id, post_type, title, status, media_ids, cover_media_id)
       values (gen_random_uuid(), $1, $2, 'Bài thử', $3, $4::jsonb, $5) returning id`,
      [AUTHOR_ID, postType, status, JSON.stringify(mediaIds), coverMediaId],
    );
    return rows[0]!.id;
  }

  async function readPost(id: string): Promise<PostRow> {
    const { rows } = await pool.query<PostRow>(
      'select post_type, media_ids, cover_media_id from content.posts where id = $1',
      [id],
    );
    return rows[0]!;
  }

  it('gỡ video, giữ ảnh và id lạ theo thứ tự; Reels, bài chỉ có ảnh và bài đã xoá giữ nguyên', async () => {
    const videoOnly = await insertPost('vlog', 'published', [VIDEO_A], VIDEO_A);
    const mixed = await insertPost('vlog', 'published', [IMAGE_B, VIDEO_A, UNKNOWN_ID, IMAGE_A], IMAGE_A);
    const draftTwoVideos = await insertPost('vlog', 'draft', [VIDEO_A, VIDEO_B], VIDEO_B);
    const stringMediaIds = await insertPost('vlog', 'published', VIDEO_B, null);
    const imagesOnly = await insertPost('vlog', 'published', [IMAGE_A, IMAGE_B], IMAGE_A);
    const reel = await insertPost('video', 'published', [VIDEO_A], VIDEO_A);
    const deleted = await insertPost('vlog', 'deleted', [VIDEO_A], VIDEO_A);

    await pool.query(CLEANUP_SQL);

    await expect(readPost(videoOnly)).resolves.toEqual({ post_type: 'vlog', media_ids: [], cover_media_id: null });
    await expect(readPost(mixed)).resolves.toEqual({
      post_type: 'vlog',
      media_ids: [IMAGE_B, UNKNOWN_ID, IMAGE_A],
      cover_media_id: IMAGE_A,
    });
    await expect(readPost(draftTwoVideos)).resolves.toEqual({ post_type: 'vlog', media_ids: [], cover_media_id: null });
    await expect(readPost(stringMediaIds)).resolves.toEqual({ post_type: 'vlog', media_ids: [], cover_media_id: null });
    await expect(readPost(imagesOnly)).resolves.toEqual({
      post_type: 'vlog',
      media_ids: [IMAGE_A, IMAGE_B],
      cover_media_id: IMAGE_A,
    });
    await expect(readPost(reel)).resolves.toEqual({ post_type: 'video', media_ids: [VIDEO_A], cover_media_id: VIDEO_A });
    await expect(readPost(deleted)).resolves.toEqual({ post_type: 'vlog', media_ids: [VIDEO_A], cover_media_id: VIDEO_A });
  });

  it('chạy lại lần nữa không đổi gì', async () => {
    const result = await pool.query(CLEANUP_SQL);
    expect(result.rowCount).toBe(0);
  });
});
