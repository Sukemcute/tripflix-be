import { readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import type { MediaRenditionCompletedV1 } from '@tripflix/contracts';
import { InMemoryObjectStorage } from '@tripflix/storage';
import { FakeTranscoder } from '../testing/fake-transcoder.js';
import { TranscodeJob, TranscodeLevelError } from './transcode-job.js';

const ASSET_ID = '11111111-1111-4111-8111-111111111111';
const SOURCE_KEY = `dev/test/uploads/${ASSET_ID}/original.mp4`;
const PREFIX = `dev/test/videos/${ASSET_ID}/r1`;
const REQUEST = { assetId: ASSET_ID, sourceKey: SOURCE_KEY, revision: 1 };

async function setup(transcoder = new FakeTranscoder()) {
  const storage = new InMemoryObjectStorage({ keyPrefix: 'dev/test/' });
  await storage.putObject({ key: SOURCE_KEY, body: Buffer.from('video'), contentType: 'video/mp4' });
  const renditions: MediaRenditionCompletedV1[] = [];
  const job = new TranscodeJob(storage, transcoder, (rendition) => {
    renditions.push(rendition);
    return Promise.resolve();
  });
  const run = () => job.run(REQUEST, new AbortController().signal);
  const readMaster = () => Buffer.from(storage.getStoredObjectForTest(`${PREFIX}/master.m3u8`)!.body).toString();
  return { storage, transcoder, renditions, run, readMaster };
}

const countWorkDirs = async () => (await readdir(tmpdir())).filter((name) => name.startsWith('video-worker-')).length;

describe('TranscodeJob', () => {
  it('làm từng mức từ thấp lên cao và báo mỗi mức một lần', async () => {
    const { renditions, transcoder, run } = await setup();

    await run();

    expect(transcoder.encodedLevels).toEqual([360, 540, 720]);
    expect(renditions).toEqual(
      [360, 540, 720].map((level) => ({
        assetId: ASSET_ID,
        level,
        hlsPrefix: PREFIX,
        durationSec: 43,
        aspect: '9:16',
      })),
    );
  });

  it('khi báo xong 360p thì đã có ảnh bìa, đoạn video và master chỉ có 360p', async () => {
    const storage = new InMemoryObjectStorage({ keyPrefix: 'dev/test/' });
    await storage.putObject({ key: SOURCE_KEY, body: Buffer.from('video'), contentType: 'video/mp4' });
    const seen: { level: number; master: string; hasPoster: boolean; hasSegment: boolean }[] = [];
    const job = new TranscodeJob(storage, new FakeTranscoder(), (rendition) => {
      seen.push({
        level: rendition.level,
        master: Buffer.from(storage.getStoredObjectForTest(`${PREFIX}/master.m3u8`)!.body).toString(),
        hasPoster: [360, 540, 720].every((width) => storage.getStoredObjectForTest(`${PREFIX}/poster_${width}.jpg`)),
        hasSegment: Boolean(storage.getStoredObjectForTest(`${PREFIX}/${rendition.level}p/seg_000.ts`)),
      });
      return Promise.resolve();
    });

    await job.run(REQUEST, new AbortController().signal);

    expect(seen[0]).toMatchObject({ level: 360, hasPoster: true, hasSegment: true });
    expect(seen[0]!.master).toContain('360p/index.m3u8');
    expect(seen[0]!.master).not.toContain('540p/index.m3u8');
    expect(seen[2]!.master).toContain('720p/index.m3u8');
  });

  it('đặt cache và loại file đúng: master 60 giây, còn lại không đổi', async () => {
    const { storage, run } = await setup();

    await run();

    expect(storage.getStoredObjectForTest(`${PREFIX}/master.m3u8`)).toMatchObject({
      cacheControl: 'public, max-age=60',
      contentType: 'application/vnd.apple.mpegurl',
    });
    const immutable = 'public, max-age=31536000, immutable';
    expect(storage.getStoredObjectForTest(`${PREFIX}/360p/index.m3u8`)).toMatchObject({
      cacheControl: immutable,
      contentType: 'application/vnd.apple.mpegurl',
    });
    expect(storage.getStoredObjectForTest(`${PREFIX}/360p/seg_000.ts`)).toMatchObject({
      cacheControl: immutable,
      contentType: 'video/mp2t',
    });
    expect(storage.getStoredObjectForTest(`${PREFIX}/poster_540.jpg`)).toMatchObject({
      cacheControl: immutable,
      contentType: 'image/jpeg',
    });
  });

  it('video gốc nhỏ thì chỉ làm các mức không phóng to', async () => {
    const transcoder = new FakeTranscoder({ displayWidth: 540, displayHeight: 960, durationSeconds: 5, hasAudio: true });
    const { renditions, run } = await setup(transcoder);

    await run();

    expect(renditions.map((rendition) => rendition.level)).toEqual([360, 540]);
  });

  it('giao lại việc: mức đã xong không làm lại nhưng vẫn báo lại, làm tiếp mức còn thiếu', async () => {
    const transcoder = new FakeTranscoder();
    transcoder.failOnLevels.add(540);
    const { renditions, run, readMaster } = await setup(transcoder);
    await expect(run()).rejects.toBeInstanceOf(TranscodeLevelError);
    expect(renditions.map((rendition) => rendition.level)).toEqual([360]);

    transcoder.failOnLevels.clear();
    transcoder.encodedLevels.length = 0;
    transcoder.posterWidths.length = 0;
    renditions.length = 0;
    await run();

    expect(transcoder.encodedLevels).toEqual([540, 720]);
    expect(transcoder.posterWidths).toEqual([]);
    expect(renditions.map((rendition) => rendition.level)).toEqual([360, 540, 720]);
    expect(readMaster()).toContain('720p/index.m3u8');
  });

  it('giao lại khi đã xong hết: không chuyển mã lại, master vẫn đủ các mức', async () => {
    const { transcoder, renditions, run, readMaster } = await setup();
    await run();
    transcoder.encodedLevels.length = 0;
    renditions.length = 0;

    await run();

    expect(transcoder.encodedLevels).toEqual([]);
    expect(renditions.map((rendition) => rendition.level)).toEqual([360, 540, 720]);
    expect(readMaster()).toContain('720p/index.m3u8');
  });

  it('mức lỗi thì không ghi index.m3u8 để lần sau làm lại, và báo đúng mức lỗi', async () => {
    const transcoder = new FakeTranscoder();
    transcoder.failOnLevels.add(720);
    const { storage, run } = await setup(transcoder);

    await expect(run()).rejects.toMatchObject({ level: 720, message: 'FFmpeg lỗi giả ở 720p' });

    expect(storage.getStoredObjectForTest(`${PREFIX}/720p/index.m3u8`)).toBeUndefined();
  });

  it('đoạn cuối quá ngắn thì coi là lỗi, không tải lên', async () => {
    const transcoder = new FakeTranscoder();
    transcoder.playlist = '#EXTM3U\n#EXTINF:2.0,\nseg_000.ts\n#EXTINF:0.2,\nseg_001.ts\n';
    const { storage, run } = await setup(transcoder);

    await expect(run()).rejects.toMatchObject({ level: 360 });

    expect(storage.getStoredObjectForTest(`${PREFIX}/360p/seg_000.ts`)).toBeUndefined();
  });

  it('không tìm thấy file gốc thì báo lỗi ở mức thấp nhất', async () => {
    const { storage, run } = await setup();
    vi.spyOn(storage, 'getObject').mockRejectedValueOnce(new Error('không có file gốc'));

    await expect(run()).rejects.toMatchObject({ level: 360, message: 'không có file gốc' });
  });

  it('xoá thư mục tạm cả khi thành công và khi lỗi', async () => {
    const before = await countWorkDirs();
    const transcoder = new FakeTranscoder();
    const { run } = await setup(transcoder);

    await run();
    expect(await countWorkDirs()).toBe(before);

    transcoder.failOnLevels.add(360);
    const failing = await setup(transcoder);
    await expect(failing.run()).rejects.toBeInstanceOf(TranscodeLevelError);
    expect(await countWorkDirs()).toBe(before);
  });
});
