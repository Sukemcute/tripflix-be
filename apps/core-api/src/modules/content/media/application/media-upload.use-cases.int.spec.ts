import 'reflect-metadata';
import { fileURLToPath } from 'node:url';
import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ContentMediaTranscodeRequestedV1Schema, eventEnvelopeSchema } from '@tripflix/contracts';
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
import { STREAMS } from '@tripflix/event-bus';
import { InMemoryObjectStorage } from '@tripflix/storage';
import { migrateModule, startPostgres, startRedis, type PostgresFixture, type RedisFixture } from '@tripflix/testing';
import { Redis } from 'ioredis';
import { ClsModule } from 'nestjs-cls';
import type pg from 'pg';
import type { CoreEnv } from '../../../../platform/env.js';
import type { DbPools } from '../../../../platform/tokens.js';
import { ContentOutboxRelay } from '../../social/infra/content-outbox-relay.js';
import { DrizzleMediaAssetStore } from '../infra/drizzle-media-asset.store.js';
import { MediaUploadUseCases } from './media-upload.use-cases.js';
import { MEDIA_ASSET_STORE, MEDIA_CLOCK, OBJECT_STORAGE, type MediaAssetStore } from './ports.js';

const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const BODY = Buffer.from('hello world');

/**
 * @Transactional('content') trên Postgres thật: trạng thái và sự kiện cùng commit hoặc cùng rollback;
 * relay chia sự kiện vào đúng stream của Redis thật.
 */
describe('MediaUploadUseCases.completeUpload trên Postgres, Redis thật', () => {
  let postgres: PostgresFixture;
  let redisFixture: RedisFixture;
  let pool: pg.Pool;
  let db: Db;
  let redis: Redis;
  let storage: InMemoryObjectStorage;
  let useCases: MediaUploadUseCases;
  let shouldFailOutbox = false;

  async function createCompletableUpload() {
    const { assetId } = await useCases.createUpload(OWNER_ID, {
      mimeType: 'video/mp4',
      fileSizeBytes: BODY.byteLength,
      durationSec: 5,
    });
    const result = await pool.query<{ s3_upload_id: string; source_key: string }>(
      'select s3_upload_id, source_key from content.media_assets where id = $1',
      [assetId],
    );
    const { s3_upload_id: s3UploadId, source_key: sourceKey } = result.rows[0]!;
    const etag = storage.uploadPartForTest(s3UploadId, 1, BODY);
    return { assetId, sourceKey, parts: [{ partNumber: 1, etag }] };
  }

  async function readAsset(assetId: string) {
    const result = await pool.query<{ status: string; transcode_attempts: number }>(
      'select status, transcode_attempts from content.media_assets where id = $1',
      [assetId],
    );
    return result.rows[0];
  }

  async function countOutboxRows(assetId: string) {
    const result = await pool.query<{ n: number }>(
      "select count(*)::int as n from content.outbox_events where payload->>'assetId' = $1",
      [assetId],
    );
    return result.rows[0]!.n;
  }

  beforeAll(async () => {
    [postgres, redisFixture] = await Promise.all([startPostgres(), startRedis()]);
    const url = postgres.buildModuleUrl('content');
    await migrateModule({
      url,
      module: 'content',
      migrationsFolder: fileURLToPath(new URL('../../db/migrations', import.meta.url)),
    });
    pool = createPool({ url, max: 5, applicationName: 'media-complete-int-test' });
    db = createDb(pool);
    redis = new Redis(redisFixture.url);
    storage = new InMemoryObjectStorage({ keyPrefix: 'dev/test/' });

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
        MediaUploadUseCases,
        { provide: OBJECT_STORAGE, useValue: storage },
        { provide: MEDIA_CLOCK, useValue: () => new Date() },
        {
          provide: MEDIA_ASSET_STORE,
          inject: [buildTransactionHostToken('content')],
          useFactory: (txHost: ModuleTransactionHost): MediaAssetStore => {
            const store = new DrizzleMediaAssetStore(() => txHost.tx);
            // Giả lỗi ở bước ghi outbox để kiểm rollback trạng thái video.
            const add = store.outbox.add.bind(store.outbox);
            store.outbox.add = async (event) => {
              if (shouldFailOutbox) throw new Error('outbox lỗi giả');
              return add(event);
            };
            return store;
          },
        },
      ],
    }).compile();
    await moduleRef.init();
    useCases = moduleRef.get(MediaUploadUseCases);
  });

  afterAll(async () => {
    redis?.disconnect();
    await pool?.end();
    await Promise.all([postgres?.stop(), redisFixture?.stop()]);
  });

  it('trạng thái và sự kiện cùng được commit, revision bắt đầu từ 1', async () => {
    const { assetId, parts } = await createCompletableUpload();

    await expect(useCases.completeUpload(OWNER_ID, assetId, parts)).resolves.toEqual({ assetId, status: 'processing' });

    expect(await readAsset(assetId)).toEqual({ status: 'processing', transcode_attempts: 1 });
    expect(await countOutboxRows(assetId)).toBe(1);
  });

  it('ghi outbox lỗi thì rollback trạng thái; gọi lại thì thành công dù S3 đã ghép xong', async () => {
    const { assetId, parts } = await createCompletableUpload();

    shouldFailOutbox = true;
    await expect(useCases.completeUpload(OWNER_ID, assetId, parts)).rejects.toThrow('outbox lỗi giả');
    shouldFailOutbox = false;
    expect(await readAsset(assetId)).toEqual({ status: 'uploading', transcode_attempts: 0 });
    expect(await countOutboxRows(assetId)).toBe(0);

    await expect(useCases.completeUpload(OWNER_ID, assetId, parts)).resolves.toEqual({ assetId, status: 'processing' });
    expect(await readAsset(assetId)).toEqual({ status: 'processing', transcode_attempts: 1 });
    expect(await countOutboxRows(assetId)).toBe(1);
  });

  it('nhiều lần gọi cùng lúc chỉ giao một việc chuyển mã', async () => {
    const { assetId, parts } = await createCompletableUpload();

    await Promise.all(Array.from({ length: 5 }, () => useCases.completeUpload(OWNER_ID, assetId, parts)));

    expect(await readAsset(assetId)).toEqual({ status: 'processing', transcode_attempts: 1 });
    expect(await countOutboxRows(assetId)).toBe(1);
  });

  it('relay đưa việc chuyển mã vào stream:media, đúng hợp đồng, rồi đánh dấu đã gửi', async () => {
    const { assetId, sourceKey, parts } = await createCompletableUpload();
    await useCases.completeUpload(OWNER_ID, assetId, parts);
    // Chạy relay thật của module content. Các test trước cũng để lại sự kiện, nên chờ tới khi gửi hết.
    const relay = new ContentOutboxRelay({ APP_ROLE: 'all' } as CoreEnv, { content: pool } as DbPools, redis);
    relay.onApplicationBootstrap();
    await vi.waitFor(
      async () => {
        const pending = await pool.query<{ n: number }>(
          'select count(*)::int as n from content.outbox_events where published_at is null',
        );
        expect(pending.rows[0]!.n).toBe(0);
      },
      { timeout: 10_000, interval: 100 },
    );
    await relay.onApplicationShutdown();

    const entries = await redis.xrange(STREAMS.media, '-', '+');
    const envelopes = entries.map(([, fields]) => eventEnvelopeSchema.parse(JSON.parse(fields[1]!)));
    const envelope = envelopes.find((candidate) => candidate.payload.assetId === assetId);
    expect(envelope).toMatchObject({ type: 'content.media.transcode_requested', userId: OWNER_ID });
    expect(ContentMediaTranscodeRequestedV1Schema.parse(envelope?.payload)).toEqual({ assetId, sourceKey, revision: 1 });
    expect(await redis.xlen(STREAMS.content)).toBe(0);
  });
});
