import { randomUUID } from 'node:crypto';
import { eventEnvelopeSchema, type EventEnvelope } from '@tripflix/contracts';
import { STREAMS } from '@tripflix/event-bus';
import { InMemoryObjectStorage } from '@tripflix/storage';
import { startRedis, type RedisFixture } from '@tripflix/testing';
import { Redis } from 'ioredis';
import { FakeTranscoder } from '../testing/fake-transcoder.js';
import { TranscodeConsumer, MAX_TRANSCODE_ATTEMPTS } from './transcode-consumer.js';

const GROUP = 'video-worker';
const OWNER_ID = '22222222-2222-4222-8222-222222222222';
const silentLogger = { info: () => undefined, error: () => undefined };

describe('TranscodeConsumer trên Redis thật', () => {
  let fixture: RedisFixture;
  let redis: Redis;
  const consumers: TranscodeConsumer[] = [];

  beforeAll(async () => {
    fixture = await startRedis();
    redis = new Redis(fixture.url);
  });

  afterAll(async () => {
    redis?.disconnect();
    await fixture?.stop();
  });

  beforeEach(async () => {
    await redis.flushall();
  });

  afterEach(async () => {
    await Promise.all(consumers.splice(0).map((consumer) => consumer.stop()));
  });

  async function setup(transcoder = new FakeTranscoder(), options: { claimIdleMs?: number; heartbeatMs?: number } = {}) {
    const assetId = randomUUID();
    const sourceKey = `dev/test/uploads/${assetId}/original.mp4`;
    const storage = new InMemoryObjectStorage({ keyPrefix: 'dev/test/' });
    await storage.putObject({ key: sourceKey, body: Buffer.from('video'), contentType: 'video/mp4' });
    const consumer = new TranscodeConsumer({
      redis,
      consumerName: 'worker-1',
      storage,
      transcoder,
      logger: silentLogger,
      blockMs: 50,
      ...options,
    });
    consumers.push(consumer);
    return { assetId, sourceKey, storage, transcoder, consumer };
  }

  async function publishRequest(payload: Record<string, unknown>, type = 'content.media.transcode_requested') {
    const envelope: EventEnvelope = {
      eventId: randomUUID(),
      type,
      version: 1,
      occurredAt: new Date().toISOString(),
      producer: 'core-api/content',
      userId: OWNER_ID,
      payload,
    };
    await redis.xadd(STREAMS.media, '*', 'event', JSON.stringify(envelope));
  }

  async function readResults(type: string): Promise<EventEnvelope[]> {
    const entries = await redis.xrange(STREAMS.media, '-', '+');
    return entries
      .map(([, fields]) => eventEnvelopeSchema.parse(JSON.parse(fields[1]!)) as EventEnvelope)
      .filter((event) => event.type === type);
  }

  const readPendingCount = async () => ((await redis.xpending(STREAMS.media, GROUP)) as [number])[0];

  it('nhận việc, phát kết quả từng mức lên stream:media rồi XACK', async () => {
    const { assetId, sourceKey, consumer } = await setup();
    await publishRequest({ assetId, sourceKey, revision: 1 });

    await consumer.start();

    await vi.waitFor(async () => expect(await readResults('media.rendition.completed')).toHaveLength(3), {
      timeout: 15_000,
    });
    const results = await readResults('media.rendition.completed');
    expect(results.map((event) => event.payload.level)).toEqual([360, 540, 720]);
    expect(results[0]).toMatchObject({
      producer: 'video-worker',
      userId: OWNER_ID,
      payload: { assetId, hlsPrefix: `dev/test/videos/${assetId}/r1`, durationSec: 43, aspect: '9:16' },
    });
    await vi.waitFor(async () => expect(await readPendingCount()).toBe(0), { timeout: 15_000 });
  });

  it('bỏ qua kết quả của chính worker và loại sự kiện khác, vẫn XACK', async () => {
    const { transcoder, consumer } = await setup();
    await publishRequest({ assetId: randomUUID(), level: 360 }, 'media.rendition.completed');

    await consumer.start();

    await vi.waitFor(
      async () => {
        const groups = (await redis.xinfo('GROUPS', STREAMS.media)) as unknown[][];
        expect(groups[0]).toContain(1);
        expect(await readPendingCount()).toBe(0);
      },
      { timeout: 15_000 },
    );
    expect(transcoder.encodedLevels).toEqual([]);
  });

  it(`lỗi thì không XACK, thử đủ ${MAX_TRANSCODE_ATTEMPTS} lần rồi phát media.transcode.failed và XACK`, async () => {
    const transcoder = new FakeTranscoder();
    transcoder.failOnLevels.add(360);
    const { assetId, sourceKey, consumer } = await setup(transcoder, { claimIdleMs: 100 });
    await publishRequest({ assetId, sourceKey, revision: 1 });

    await consumer.start();

    await vi.waitFor(async () => expect(await readResults('media.transcode.failed')).toHaveLength(1), {
      timeout: 20_000,
      interval: 100,
    });
    const [failure] = await readResults('media.transcode.failed');
    expect(failure).toMatchObject({
      payload: { assetId, level: 360, reason: 'FFmpeg lỗi giả ở 360p', attempts: MAX_TRANSCODE_ATTEMPTS },
    });
    await vi.waitFor(async () => expect(await readPendingCount()).toBe(0), { timeout: 15_000 });
    expect(await readResults('media.rendition.completed')).toHaveLength(0);
  });

  it('360p xong mà mức cao lỗi: giữ kết quả 360p và báo lỗi đúng mức', async () => {
    const transcoder = new FakeTranscoder();
    transcoder.failOnLevels.add(540);
    const { assetId, sourceKey, consumer } = await setup(transcoder, { claimIdleMs: 100 });
    await publishRequest({ assetId, sourceKey, revision: 1 });

    await consumer.start();

    await vi.waitFor(async () => expect(await readResults('media.transcode.failed')).toHaveLength(1), {
      timeout: 20_000,
      interval: 100,
    });
    const [failure] = await readResults('media.transcode.failed');
    expect(failure?.payload.level).toBe(540);
    const levels = (await readResults('media.rendition.completed')).map((event) => event.payload.level);
    expect(new Set(levels)).toEqual(new Set([360]));
    expect(transcoder.encodedLevels).toEqual([360]);
  });

  it('đang làm lâu thì báo còn sống: việc không bị nhận lại và không tăng số lần giao', async () => {
    const transcoder = new FakeTranscoder();
    const encodeLevel = transcoder.encodeLevel.bind(transcoder);
    let shouldDelay = true;
    let maxDeliveries = 0;
    transcoder.encodeLevel = async (input) => {
      if (shouldDelay) {
        shouldDelay = false;
        // Lâu hơn claimIdleMs nhiều lần. Không có báo còn sống thì việc đã bị nhận lại.
        for (let round = 0; round < 15; round += 1) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          const pending = (await redis.xpending(STREAMS.media, GROUP, '-', '+', 1)) as [string, string, number, number][];
          maxDeliveries = Math.max(maxDeliveries, pending[0]?.[3] ?? 0);
        }
      }
      return encodeLevel(input);
    };
    const { assetId, sourceKey, consumer } = await setup(transcoder, { claimIdleMs: 500, heartbeatMs: 100 });
    await publishRequest({ assetId, sourceKey, revision: 1 });

    await consumer.start();

    await vi.waitFor(async () => expect(await readResults('media.rendition.completed')).toHaveLength(3), {
      timeout: 15_000,
    });
    expect(maxDeliveries).toBe(1);
    expect(transcoder.encodedLevels).toEqual([360, 540, 720]);
  });

  it('dừng worker giữa chừng thì không XACK và không báo lỗi, để việc được giao lại', async () => {
    const transcoder = new FakeTranscoder();
    let markStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    transcoder.encodeLevel = ({ signal }) =>
      new Promise((_resolve, reject) => {
        markStarted();
        signal.addEventListener('abort', () => reject(new Error('FFmpeg bị dừng')));
      });
    const { assetId, sourceKey, consumer } = await setup(transcoder);
    await publishRequest({ assetId, sourceKey, revision: 1 });

    await consumer.start();
    await started;
    await consumer.stop();
    consumers.length = 0;

    expect(await readPendingCount()).toBe(1);
    expect(await readResults('media.transcode.failed')).toHaveLength(0);
  });
});
