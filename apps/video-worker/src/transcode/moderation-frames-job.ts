import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import {
  sampleFrameTimes,
  type MediaFramesRequestedV1,
  type MediaFramesCompletedV1,
} from '@tripflix/contracts';
import type { ObjectStorage } from '@tripflix/storage';
import type { Transcoder } from './ffmpeg.js';

export const MAX_FRAME_SOURCE_BYTES = 1_073_741_824;
export function limitFrameSourceBytes(maxBytes = MAX_FRAME_SOURCE_BYTES): Transform {
  let received = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length;
      callback(received > maxBytes ? new FrameExtractionError('source_too_large') : null, chunk);
    },
  });
}
export class FrameExtractionError extends Error {
  constructor(readonly code: 'video_too_long' | 'source_too_large' | 'extraction_failed') {
    super(code);
  }
}
export function buildFrameArgs(sourcePath: string, outputPath: string, timestampMs: number): string[] {
  return [
    '-nostdin',
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-ss',
    (timestampMs / 1000).toFixed(3),
    '-i',
    sourcePath,
    '-map',
    '0:v:0',
    '-map_metadata',
    '-1',
    '-frames:v',
    '1',
    '-vf',
    'scale=640:640:force_original_aspect_ratio=decrease:force_divisible_by=2',
    '-q:v',
    '4',
    outputPath,
  ];
}
export type ExtractFrame = (
  source: string,
  output: string,
  timestampMs: number,
  signal: AbortSignal,
) => Promise<void>;
export const extractFrame: ExtractFrame = (source, output, timestampMs, signal) =>
  new Promise((resolve, reject) => {
    const process = spawn('ffmpeg', buildFrameArgs(source, output, timestampMs), {
      signal,
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    process.once('error', reject);
    process.once('exit', (code) =>
      code === 0 ? resolve() : reject(new FrameExtractionError('extraction_failed')),
    );
  });

export class ModerationFramesJob {
  constructor(
    private readonly storage: ObjectStorage,
    private readonly transcoder: Transcoder,
    private readonly extract: ExtractFrame = extractFrame,
  ) {}
  async run(request: MediaFramesRequestedV1, signal: AbortSignal): Promise<MediaFramesCompletedV1> {
    if ((await this.storage.getObjectSizeBytes(request.sourceKey)) > MAX_FRAME_SOURCE_BYTES)
      throw new FrameExtractionError('source_too_large');
    const dir = await mkdtemp(join(tmpdir(), 'moderation-frames-'));
    try {
      const source = join(dir, 'source');
      await pipeline(
        await this.storage.getObject(request.sourceKey),
        limitFrameSourceBytes(),
        createWriteStream(source),
        { signal },
      );
      const video = await this.transcoder.probe(source, signal);
      const durationMs = Math.round(video.durationSeconds * 1000);
      let times: number[];
      try {
        times = sampleFrameTimes(durationMs);
      } catch {
        throw new FrameExtractionError('video_too_long');
      }
      const frames = [];
      for (const timestampMs of times) {
        signal.throwIfAborted();
        const key = `${request.hlsPrefix}/moderation/${request.policy}/${request.requestId}/${timestampMs}.jpg`;
        const output = join(dir, `${timestampMs}.jpg`);
        await this.extract(source, output, timestampMs, signal);
        const body = await readFile(output);
        if (!body.length || body.length > 1_048_576) throw new FrameExtractionError('extraction_failed');
        await this.storage.putObject({
          key,
          body,
          contentType: 'image/jpeg',
          cacheControl: 'public, max-age=31536000, immutable',
        });
        frames.push({ key, timestampMs });
      }
      return {
        assetId: request.assetId,
        requestId: request.requestId,
        hlsPrefix: request.hlsPrefix,
        policy: request.policy,
        durationMs,
        frames,
      };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
