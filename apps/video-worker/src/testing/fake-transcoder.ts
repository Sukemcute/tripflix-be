import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { MediaQualityLevel } from '@tripflix/contracts';
import type { CreatePosterInput, EncodeLevelInput, Transcoder } from '../transcode/ffmpeg.js';
import type { VideoMetadata } from '../transcode/levels.js';

/** Ghi file giả thay cho FFmpeg, dùng cho test vì CI không cài FFmpeg. */
export class FakeTranscoder implements Transcoder {
  readonly encodedLevels: MediaQualityLevel[] = [];
  readonly posterWidths: number[] = [];
  failOnLevels = new Set<MediaQualityLevel>();
  playlist = '#EXTM3U\n#EXTINF:2.0,\nseg_000.ts\n#EXTINF:1.0,\nseg_001.ts\n#EXT-X-ENDLIST\n';

  constructor(
    private readonly video: VideoMetadata = {
      displayWidth: 1080,
      displayHeight: 1920,
      durationSeconds: 42.5,
      hasAudio: true,
    },
  ) {}

  probe(): Promise<VideoMetadata> {
    return Promise.resolve(this.video);
  }

  async encodeLevel({ outputDir, rung }: EncodeLevelInput): Promise<void> {
    if (this.failOnLevels.has(rung.level)) throw new Error(`FFmpeg lỗi giả ở ${rung.level}p`);
    this.encodedLevels.push(rung.level);
    await writeFile(join(outputDir, 'seg_000.ts'), 'segment-0');
    await writeFile(join(outputDir, 'seg_001.ts'), 'segment-1');
    await writeFile(join(outputDir, 'index.m3u8'), this.playlist);
  }

  async createPoster({ outputPath, width }: CreatePosterInput): Promise<void> {
    this.posterWidths.push(width);
    await writeFile(outputPath, `poster-${width}`);
  }
}
