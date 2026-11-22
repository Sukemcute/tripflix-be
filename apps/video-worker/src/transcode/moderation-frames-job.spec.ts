import { writeFile } from 'node:fs/promises';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { InMemoryObjectStorage } from '@tripflix/storage';
import { MediaFramesCompletedV1Schema, FRAME_POLICY } from '@tripflix/contracts';
import { FakeTranscoder } from '../testing/fake-transcoder.js';
import { ModerationFramesJob, buildFrameArgs, limitFrameSourceBytes } from './moderation-frames-job.js';
const request = {
  assetId: '11111111-1111-4111-8111-111111111111',
  requestId: '22222222-2222-4222-8222-222222222222',
  sourceKey: 'source',
  hlsPrefix: 'test/videos/r1',
  policy: FRAME_POLICY,
} as const;
it('uploads every sampled frame with independent timestamp and immutable key', async () => {
  const storage = new InMemoryObjectStorage();
  await storage.putObject({ key: 'source', body: Buffer.from('video'), contentType: 'video/mp4' });
  const seen: number[] = [];
  const job = new ModerationFramesJob(
    storage,
    new FakeTranscoder({ durationSeconds: 10, displayWidth: 640, displayHeight: 480, hasAudio: false }),
    async (_source, out, ms) => {
      seen.push(ms);
      await writeFile(out, Buffer.from('frame'));
    },
  );
  const manifest = await job.run(request, new AbortController().signal);
  expect(seen).toEqual([0, 4950, 9900]);
  expect(MediaFramesCompletedV1Schema.safeParse(manifest).success).toBe(true);
  for (const frame of manifest.frames)
    expect(storage.getStoredObjectForTest(frame.key)?.contentType).toBe('image/jpeg');
});
it('fails extraction rather than claiming a partial video is clean', async () => {
  const storage = new InMemoryObjectStorage();
  await storage.putObject({ key: 'source', body: Buffer.from('video'), contentType: 'video/mp4' });
  const job = new ModerationFramesJob(storage, new FakeTranscoder(), async () => {
    throw new Error('extract failed');
  });
  await expect(job.run(request, new AbortController().signal)).rejects.toThrow('extract failed');
  const invalid = new ModerationFramesJob(
    storage,
    new FakeTranscoder({ durationSeconds: 301, displayWidth: 640, displayHeight: 480, hasAudio: false }),
  );
  await expect(invalid.run(request, new AbortController().signal)).rejects.toThrow('video_too_long');
});
it('uses exact millisecond seek and strips metadata without invoking a shell', () => {
  const args = buildFrameArgs('a;bad.mp4', 'out.jpg', 4950);
  expect(args[args.indexOf('-ss') + 1]).toBe('4.950');
  expect(args).toContain('a;bad.mp4');
  expect(args[args.indexOf('-map_metadata') + 1]).toBe('-1');
  expect(args).toContain('scale=640:640:force_original_aspect_ratio=decrease:force_divisible_by=2');
});
it('stops an oversized source even if storage reports a smaller size', async () => {
  const sink = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
  await expect(
    pipeline(Readable.from([Buffer.alloc(3), Buffer.alloc(2)]), limitFrameSourceBytes(4), sink),
  ).rejects.toThrow('source_too_large');
});
