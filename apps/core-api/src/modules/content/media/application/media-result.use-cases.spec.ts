import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { createNoOpTransactionalPlugins } from '@tripflix/db';
import { InMemoryObjectStorage } from '@tripflix/storage';
import { ClsModule } from 'nestjs-cls';
import { MemoryMediaAssetStore } from '../infra/memory/memory-media-asset.store.js';
import { MediaFacade } from '../media.facade.js';
import { MediaResultUseCases } from './media-result.use-cases.js';

const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const ASSET_ID = '22222222-2222-4222-8222-222222222222';
const HLS_PREFIX = `dev/test/videos/${ASSET_ID}/r1`;

const buildRendition = (level: 360 | 540 | 720) => ({
  assetId: ASSET_ID,
  level,
  hlsPrefix: HLS_PREFIX,
  durationSec: 43,
  aspect: '9:16' as const,
});
const buildFailure = (level: 360 | 540 | 720) => ({ assetId: ASSET_ID, level, reason: 'FFmpeg lỗi', attempts: 3 });

// Khởi tạo TransactionHost (plugin no-op) một lần để @Transactional('content') chạy được khi tạo use case trực tiếp.
beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [ClsModule.forRoot({ global: true, plugins: createNoOpTransactionalPlugins() })],
  }).compile();
  await moduleRef.init();
});

async function setup() {
  const store = new MemoryMediaAssetStore();
  await store.insertUploadingAsset({
    id: ASSET_ID,
    ownerId: OWNER_ID,
    mimeType: 'video/mp4',
    fileSizeBytes: 1,
    sourceKey: 'k',
    s3UploadId: 'u',
    durationSec: 40,
  });
  await store.markProcessing(ASSET_ID);
  const storage = new InMemoryObjectStorage({ keyPrefix: 'dev/test/', cdnBaseUrl: 'https://cdn.test' });
  return {
    store,
    asset: store.assets.get(ASSET_ID)!,
    results: new MediaResultUseCases(store),
    facade: new MediaFacade(store, storage),
  };
}

describe('MediaResultUseCases', () => {
  it('xong 360p thì chuyển ready, lưu thông tin phát và phát content.media.ready', async () => {
    const { store, asset, results } = await setup();

    await results.recordRendition(buildRendition(360));

    expect(asset).toMatchObject({ status: 'ready', hlsPrefix: HLS_PREFIX, durationSec: 43, aspect: '9:16' });
    expect(store.outboxRows).toHaveLength(1);
    expect(store.outboxRows[0]).toMatchObject({
      type: 'content.media.ready',
      userId: OWNER_ID,
      payload: { assetId: ASSET_ID, ownerId: OWNER_ID, durationSec: 43 },
    });
  });

  it('worker báo lại 360p thì không phát thêm sự kiện', async () => {
    const { store, results } = await setup();

    await results.recordRendition(buildRendition(360));
    await results.recordRendition(buildRendition(360));

    expect(store.outboxRows).toHaveLength(1);
  });

  it('mức cao hơn chỉ thêm lựa chọn chất lượng, không phát thêm sự kiện', async () => {
    const { store, asset, results } = await setup();

    await results.recordRendition(buildRendition(360));
    await results.recordRendition(buildRendition(540));
    await results.recordRendition(buildRendition(720));

    expect([...asset.levels]).toEqual([360, 540, 720]);
    expect(store.outboxRows).toHaveLength(1);
  });

  it('360p lỗi thì chuyển failed và phát content.media.failed một lần', async () => {
    const { store, asset, results } = await setup();

    await results.recordFailure(buildFailure(360));
    await results.recordFailure(buildFailure(360));

    expect(asset).toMatchObject({ status: 'failed', error: 'FFmpeg lỗi' });
    expect(store.outboxRows).toHaveLength(1);
    expect(store.outboxRows[0]).toMatchObject({
      type: 'content.media.failed',
      payload: { assetId: ASSET_ID, ownerId: OWNER_ID, reason: 'FFmpeg lỗi' },
    });
  });

  it('mức cao lỗi sau khi có 360p thì giữ ready, chỉ ghi lỗi để xem lại', async () => {
    const { store, asset, results } = await setup();
    await results.recordRendition(buildRendition(360));

    await results.recordFailure(buildFailure(540));

    expect(asset).toMatchObject({ status: 'ready', error: 'FFmpeg lỗi' });
    expect(store.outboxRows.map((event) => event.type)).toEqual(['content.media.ready']);
  });

  it('video vừa được replica khác chuyển ready thì vẫn giữ lại lỗi, không phát content.media.failed', async () => {
    const { store, asset, results } = await setup();
    asset.status = 'ready';

    await results.recordFailure(buildFailure(540));

    expect(asset).toMatchObject({ status: 'ready', error: 'FFmpeg lỗi' });
    expect(store.outboxRows).toHaveLength(0);
  });

  it('video đã failed thì kết quả đến muộn không đưa về ready', async () => {
    const { store, asset, results } = await setup();
    await results.recordFailure(buildFailure(360));

    await results.recordRendition(buildRendition(360));

    expect(asset.status).toBe('failed');
    expect(store.outboxRows.map((event) => event.type)).toEqual(['content.media.failed']);
  });

  it('kết quả của video không tồn tại thì bỏ qua, không báo lỗi', async () => {
    const { store, results } = await setup();
    const missing = { ...buildRendition(360), assetId: '33333333-3333-4333-8333-333333333333' };

    await expect(results.recordRendition(missing)).resolves.toBeUndefined();
    await expect(results.recordFailure({ ...buildFailure(360), assetId: missing.assetId })).resolves.toBeUndefined();

    expect(store.outboxRows).toHaveLength(0);
  });
});

describe('MediaFacade', () => {
  it('trả link CloudFront, 3 ảnh bìa và các mức theo thứ tự', async () => {
    const { results, facade } = await setup();
    await results.recordRendition(buildRendition(360));
    await results.recordRendition(buildRendition(720));
    await results.recordRendition(buildRendition(540));

    const playback = await facade.getPlayback([ASSET_ID, ASSET_ID]);

    expect(playback).toEqual({
      [ASSET_ID]: {
        hlsUrl: `https://cdn.test/${HLS_PREFIX}/master.m3u8`,
        posters: {
          w360: `https://cdn.test/${HLS_PREFIX}/poster_360.jpg`,
          w540: `https://cdn.test/${HLS_PREFIX}/poster_540.jpg`,
          w720: `https://cdn.test/${HLS_PREFIX}/poster_720.jpg`,
        },
        durationSec: 43,
        aspect: '9:16',
        levels: [360, 540, 720],
      },
    });
  });

  it('video chưa ready hoặc không tồn tại thì không có trong kết quả', async () => {
    const { facade } = await setup();

    await expect(facade.getPlayback([ASSET_ID, '33333333-3333-4333-8333-333333333333'])).resolves.toEqual({});
    await expect(facade.getPlayback([])).resolves.toEqual({});
  });

  it('getStatus trả trạng thái, video không tồn tại thì trả null', async () => {
    const { facade } = await setup();

    await expect(facade.getStatus(ASSET_ID)).resolves.toBe('processing');
    await expect(facade.getStatus('33333333-3333-4333-8333-333333333333')).resolves.toBeNull();
  });
});
