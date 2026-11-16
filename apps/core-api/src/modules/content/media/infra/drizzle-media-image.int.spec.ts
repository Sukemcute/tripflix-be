import { fileURLToPath } from 'node:url';
import { createDb, createPool, type Db } from '@tripflix/db';
import { InMemoryObjectStorage } from '@tripflix/storage';
import { migrateModule, startPostgres, type PostgresFixture } from '@tripflix/testing';
import type pg from 'pg';
import { MediaUploadUseCases } from '../application/media-upload.use-cases.js';
import { MediaFacade } from '../media.facade.js';
import { DrizzleMediaAssetStore } from './drizzle-media-asset.store.js';

const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);

/** Migration media_assets_image_kind và các câu truy vấn ảnh trên Postgres thật. */
describe('Ảnh trong media_assets (Postgres thật)', () => {
  let postgres: PostgresFixture;
  let pool: pg.Pool;
  let db: Db;
  let storage: InMemoryObjectStorage;
  let useCases: MediaUploadUseCases;
  let facade: MediaFacade;

  beforeAll(async () => {
    postgres = await startPostgres();
    const url = postgres.buildModuleUrl('content');
    await migrateModule({
      url,
      module: 'content',
      migrationsFolder: fileURLToPath(new URL('../../db/migrations', import.meta.url)),
    });
    pool = createPool({ url, max: 2, applicationName: 'media-image-int-test' });
    db = createDb(pool);
    const store = new DrizzleMediaAssetStore(() => db);
    storage = new InMemoryObjectStorage({ keyPrefix: 'dev/test/', cdnBaseUrl: 'https://cdn.test' });
    useCases = new MediaUploadUseCases(store, storage, () => new Date('2026-11-13T08:00:00Z'));
    facade = new MediaFacade(store, storage);
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    await postgres?.stop();
  });

  it('tải ảnh lên, hoàn tất thì ready; facade trả link CDN và kích thước', async () => {
    const { assetId } = await useCases.createUpload(OWNER_ID, {
      mimeType: 'image/jpeg',
      fileSizeBytes: JPEG_BYTES.byteLength,
      widthPx: 800,
      heightPx: 600,
    });
    const { rows } = await pool.query<{ s3_upload_id: string; kind: string; duration_sec: number | null }>(
      'select s3_upload_id, kind, duration_sec from content.media_assets where id = $1',
      [assetId],
    );
    expect(rows[0]).toMatchObject({ kind: 'image', duration_sec: null });
    const etag = storage.uploadPartForTest(rows[0]!.s3_upload_id, 1, JPEG_BYTES);

    await expect(useCases.completeUpload(OWNER_ID, assetId, [{ partNumber: 1, etag }])).resolves.toEqual({
      assetId,
      status: 'ready',
    });

    expect(await facade.getImages([assetId])).toEqual({
      [assetId]: { url: `https://cdn.test/dev/test/images/posts/${assetId}.jpg`, widthPx: 800, heightPx: 600 },
    });
    expect(await facade.getKinds([assetId])).toEqual([{ id: assetId, ownerId: OWNER_ID, kind: 'image', status: 'ready' }]);
    // Ảnh không có mức chất lượng nên không bao giờ thành video phát được trên Reels.
    expect(await facade.getPlayback([assetId])).toEqual({});
  });

  it('bản ghi video cũ (không ghi kind) mặc định là video, các ràng buộc cũ vẫn giữ', async () => {
    const { rows } = await pool.query<{ kind: string }>(
      `insert into content.media_assets (owner_id, mime_type, file_size_bytes, source_key, duration_sec)
       values ($1, 'video/mp4', 10, 'k', 5) returning kind`,
      [OWNER_ID],
    );
    expect(rows[0]?.kind).toBe('video');
    await expect(
      pool.query(
        `insert into content.media_assets (owner_id, mime_type, file_size_bytes, source_key) values ($1, 'video/mp4', 10, 'k')`,
        [OWNER_ID],
      ),
    ).rejects.toThrow(/ck_media_assets_duration_sec/);
  });

  it('DB chặn ảnh mang thời lượng hoặc loại MIME video', async () => {
    await expect(
      pool.query(
        `insert into content.media_assets (owner_id, kind, mime_type, file_size_bytes, source_key, duration_sec)
         values ($1, 'image', 'image/png', 10, 'k', 3)`,
        [OWNER_ID],
      ),
    ).rejects.toThrow(/ck_media_assets_duration_sec/);
    await expect(
      pool.query(
        `insert into content.media_assets (owner_id, kind, mime_type, file_size_bytes, source_key)
         values ($1, 'image', 'video/mp4', 10, 'k')`,
        [OWNER_ID],
      ),
    ).rejects.toThrow(/ck_media_assets_mime_type/);
  });
});
