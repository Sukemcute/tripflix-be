import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { eventEnvelopeSchema, type EventEnvelope } from '@tripflix/contracts';
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
import { STREAMS, type StreamName } from '@tripflix/event-bus';
import { InMemoryObjectStorage } from '@tripflix/storage';
import { migrateModule, startPostgres, startRedis, type PostgresFixture, type RedisFixture } from '@tripflix/testing';
import { Redis } from 'ioredis';
import { ClsModule } from 'nestjs-cls';
import type pg from 'pg';
import type { CoreEnv } from '../../../../platform/env.js';
import { CORE_ENV, REDIS, type DbPools } from '../../../../platform/tokens.js';
import { ContentOutboxRelay } from '../../social/infra/content-outbox-relay.js';
import { DrizzleMediaAssetStore } from '../infra/drizzle-media-asset.store.js';
import { MediaResultConsumer } from '../infra/media-result-consumer.js';
import { MediaFacade } from '../media.facade.js';
import { MediaResultUseCases } from './media-result.use-cases.js';
import { MEDIA_ASSET_STORE, OBJECT_STORAGE, type MediaAssetStore } from './ports.js';

const OWNER_ID = '11111111-1111-4111-8111-111111111111';

/** Kết quả từ worker qua Redis thật tới Postgres thật, rồi relay phát content.media.* vào stream:core.content. */
describe('Nhận kết quả chuyển mã trên Postgres, Redis thật', () => {
  let postgres: PostgresFixture;
  let redisFixture: RedisFixture;
  let pool: pg.Pool;
  let db: Db;
  let redis: Redis;
  let consumer: MediaResultConsumer;
  let relay: ContentOutboxRelay;
  let facade: MediaFacade;
  let results: MediaResultUseCases;
  let shouldFailOutbox = false;

  async function insertProcessingAsset(): Promise<string> {
    const assetId = randomUUID();
    await pool.query(
      `insert into content.media_assets (id, owner_id, status, mime_type, file_size_bytes, source_key, s3_upload_id, duration_sec, transcode_attempts)
       values ($1, $2, 'processing', 'video/mp4', 1, $3, 'u', 40, 1)`,
      [assetId, OWNER_ID, `dev/test/uploads/${assetId}/original.mp4`],
    );
    return assetId;
  }

  async function publish(type: string, payload: Record<string, unknown>): Promise<void> {
    const envelope: EventEnvelope = {
      eventId: randomUUID(),
      type,
      version: 1,
      occurredAt: new Date().toISOString(),
      producer: 'video-worker',
      userId: OWNER_ID,
      payload,
    };
    await redis.xadd(STREAMS.media, '*', 'event', JSON.stringify(envelope));
  }

  const buildRendition = (assetId: string, level: number) => ({
    assetId,
    level,
    hlsPrefix: `dev/test/videos/${assetId}/r1`,
    durationSec: 43,
    aspect: '9:16',
  });

  async function readAsset(assetId: string) {
    const result = await pool.query<{ status: string; hls_prefix: string | null; aspect: string | null; duration_sec: number; error: string | null }>(
      'select status, hls_prefix, aspect, duration_sec, error from content.media_assets where id = $1',
      [assetId],
    );
    return result.rows[0];
  }

  async function readEvents(stream: StreamName, assetId: string, type: string) {
    const entries = await redis.xrange(stream, '-', '+');
    return entries
      .map(([, fields]) => eventEnvelopeSchema.parse(JSON.parse(fields[1]!)))
      .filter((event) => event.type === type && event.payload.assetId === assetId);
  }

  beforeAll(async () => {
    [postgres, redisFixture] = await Promise.all([startPostgres(), startRedis()]);
    const url = postgres.buildModuleUrl('content');
    await migrateModule({
      url,
      module: 'content',
      migrationsFolder: fileURLToPath(new URL('../../db/migrations', import.meta.url)),
    });
    pool = createPool({ url, max: 5, applicationName: 'media-result-int-test' });
    db = createDb(pool);
    redis = new Redis(redisFixture.url);

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
        MediaResultUseCases,
        MediaResultConsumer,
        MediaFacade,
        { provide: CORE_ENV, useValue: { APP_ROLE: 'all' } },
        { provide: REDIS, useValue: redis },
        { provide: OBJECT_STORAGE, useValue: new InMemoryObjectStorage({ keyPrefix: 'dev/test/', cdnBaseUrl: 'https://cdn.test' }) },
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
    results = moduleRef.get(MediaResultUseCases);
    facade = moduleRef.get(MediaFacade);
    // moduleRef.init() đã bật consumer qua onApplicationBootstrap.
    consumer = moduleRef.get(MediaResultConsumer);
    relay = new ContentOutboxRelay({ APP_ROLE: 'all' } as CoreEnv, { content: pool } as DbPools, redis);
    relay.onApplicationBootstrap();
  });

  afterAll(async () => {
    await consumer?.onApplicationShutdown();
    await relay?.onApplicationShutdown();
    redis?.disconnect();
    await pool?.end();
    await Promise.all([postgres?.stop(), redisFixture?.stop()]);
  });

  it('kết quả từ worker: chuyển ready, phát content.media.ready một lần vào stream:core.content, trả được link phát', async () => {
    const assetId = await insertProcessingAsset();

    await publish('media.rendition.completed', buildRendition(assetId, 360));
    await publish('media.rendition.completed', buildRendition(assetId, 360));
    await publish('media.rendition.completed', buildRendition(assetId, 540));

    await vi.waitFor(
      async () => {
        const playback = await facade.getPlayback([assetId]);
        expect(playback[assetId]?.levels).toEqual([360, 540]);
        expect(await readEvents(STREAMS.content, assetId, 'content.media.ready')).toHaveLength(1);
      },
      { timeout: 20_000, interval: 100 },
    );
    expect(await readAsset(assetId)).toMatchObject({
      status: 'ready',
      hls_prefix: `dev/test/videos/${assetId}/r1`,
      aspect: '9:16',
      duration_sec: 43,
    });
    const playback = await facade.getPlayback([assetId]);
    expect(playback[assetId]?.hlsUrl).toBe(`https://cdn.test/dev/test/videos/${assetId}/r1/master.m3u8`);
    await expect(facade.getStatus(assetId)).resolves.toBe('ready');
    expect(await readEvents(STREAMS.media, assetId, 'content.media.ready')).toHaveLength(0);
    const [event] = await readEvents(STREAMS.content, assetId, 'content.media.ready');
    expect(event?.payload).toEqual({ assetId, ownerId: OWNER_ID, durationSec: 43 });
  });

  it('360p lỗi: chuyển failed và phát content.media.failed', async () => {
    const assetId = await insertProcessingAsset();

    await publish('media.transcode.failed', { assetId, level: 360, reason: 'FFmpeg lỗi', attempts: 3 });

    await vi.waitFor(
      async () => expect(await readEvents(STREAMS.content, assetId, 'content.media.failed')).toHaveLength(1),
      { timeout: 20_000, interval: 100 },
    );
    expect(await readAsset(assetId)).toMatchObject({ status: 'failed', error: 'FFmpeg lỗi' });
    await expect(facade.getPlayback([assetId])).resolves.toEqual({});
  });

  it('mức cao lỗi sau 360p: giữ ready và ghi lỗi, không phát content.media.failed', async () => {
    const assetId = await insertProcessingAsset();

    await publish('media.rendition.completed', buildRendition(assetId, 360));
    await publish('media.transcode.failed', { assetId, level: 540, reason: 'FFmpeg lỗi 540p', attempts: 3 });

    await vi.waitFor(async () => expect((await readAsset(assetId))?.error).toBe('FFmpeg lỗi 540p'), {
      timeout: 20_000,
      interval: 100,
    });
    expect((await readAsset(assetId))?.status).toBe('ready');
    expect(await readEvents(STREAMS.content, assetId, 'content.media.failed')).toHaveLength(0);
  });

  it('ghi outbox lỗi thì rollback cả trạng thái và mức, xử lý lại thì thành công', async () => {
    const assetId = await insertProcessingAsset();

    shouldFailOutbox = true;
    await expect(results.recordRendition(buildRendition(assetId, 360) as never)).rejects.toThrow('outbox lỗi giả');
    shouldFailOutbox = false;

    expect((await readAsset(assetId))?.status).toBe('processing');
    const rows = await pool.query('select 1 from content.renditions where asset_id = $1', [assetId]);
    expect(rows.rowCount).toBe(0);

    await results.recordRendition(buildRendition(assetId, 360) as never);
    expect((await readAsset(assetId))?.status).toBe('ready');
  });

  it('bỏ qua việc giao cho worker trong cùng stream và vẫn XACK', async () => {
    const assetId = await insertProcessingAsset();

    await publish('content.media.transcode_requested', { assetId, sourceKey: 'k', revision: 1 });

    await vi.waitFor(
      async () => {
        const pending = (await redis.xpending(STREAMS.media, 'core-media')) as [number];
        const groups = (await redis.xinfo('GROUPS', STREAMS.media)) as (string | number | null)[][];
        const group = groups.find((fields) => fields.includes('core-media'))!;
        expect(group[group.indexOf('lag') + 1]).toBe(0);
        expect(pending[0]).toBe(0);
      },
      { timeout: 20_000, interval: 100 },
    );
    expect((await readAsset(assetId))?.status).toBe('processing');
  });
});
