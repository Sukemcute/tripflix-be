import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { ContentMediaTranscodeRequestedV1, MediaQualityLevel, MediaRenditionCompletedV1 } from '@tripflix/contracts';
import { ObjectNotFoundError, type ObjectStorage } from '@tripflix/storage';
import type { Transcoder } from './ffmpeg.js';
import {
  POSTER_WIDTHS,
  QUALITY_RUNGS,
  classifyAspect,
  roundUpDurationSeconds,
  selectRungs,
  type QualityRung,
  type VideoMetadata,
} from './levels.js';
import { assertTailLongEnough, buildMasterPlaylist } from './playlist.js';

// Tên file có số phiên bản r{n} và không đổi, nên cache lâu. Riêng master bị ghi lại khi xong thêm mức.
const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';
const MASTER_CACHE_CONTROL = 'public, max-age=60';
const PLAYLIST_CONTENT_TYPE = 'application/vnd.apple.mpegurl';
const UPLOAD_CONCURRENCY = 4;

/** Lỗi ở mức chất lượng nào, để bên nhận biết còn phát được video hay không. */
export class TranscodeLevelError extends Error {
  constructor(
    readonly level: MediaQualityLevel,
    cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = 'TranscodeLevelError';
  }
}

export type RenditionPublisher = (rendition: MediaRenditionCompletedV1) => Promise<void>;

/**
 * Chuyển mã một video, làm từng mức từ thấp lên cao. Mỗi mức xong thì ghi lại master rồi mới báo.
 * Redis có thể giao lại việc: mức đã có index.m3u8 thì không làm lại, chỉ báo lại, vì lần trước
 * có thể đã chết trước khi báo. index.m3u8 được ghi sau cùng nên có nó nghĩa là đủ các đoạn.
 */
export class TranscodeJob {
  constructor(
    private readonly storage: ObjectStorage,
    private readonly transcoder: Transcoder,
    private readonly publishRendition: RenditionPublisher,
  ) {}

  async run({ assetId, sourceKey, revision }: ContentMediaTranscodeRequestedV1, signal: AbortSignal): Promise<void> {
    // Chưa làm tới mức nào thì tính là lỗi ở mức thấp nhất, vì lúc đó video chưa phát được.
    let currentLevel: MediaQualityLevel = QUALITY_RUNGS[0]!.level;
    const workDir = await mkdtemp(join(tmpdir(), 'video-worker-'));
    try {
      const sourcePath = join(workDir, 'source');
      await this.downloadSource(sourceKey, sourcePath, signal);
      const video = await this.transcoder.probe(sourcePath, signal);
      const hlsPrefix = this.storage.resolveKey(`videos/${assetId}/r${revision}`);
      const rungs = selectRungs(video);
      const rendition = { assetId, hlsPrefix, durationSec: roundUpDurationSeconds(video.durationSeconds), aspect: classifyAspect(video) };

      const doneRungs: QualityRung[] = [];
      for (const rung of rungs) {
        if (await this.hasObject(this.buildLevelPlaylistKey(hlsPrefix, rung))) doneRungs.push(rung);
      }
      if (doneRungs.length > 0) await this.uploadMaster(hlsPrefix, doneRungs, video);
      for (const rung of doneRungs) await this.publishRendition({ ...rendition, level: rung.level });

      const pendingRungs = rungs.filter((rung) => !doneRungs.includes(rung));
      for (const rung of pendingRungs) {
        currentLevel = rung.level;
        // Ảnh bìa phải có trước khi video được đăng, tức trước khi báo xong mức đầu tiên.
        if (doneRungs.length === 0) await this.createPosters(sourcePath, workDir, hlsPrefix, video, signal);
        await this.encodeAndUploadLevel(sourcePath, workDir, hlsPrefix, rung, video, signal);
        doneRungs.push(rung);
        await this.uploadMaster(hlsPrefix, doneRungs, video);
        await this.publishRendition({ ...rendition, level: rung.level });
      }
    } catch (error) {
      throw new TranscodeLevelError(currentLevel, error);
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }

  private async downloadSource(sourceKey: string, targetPath: string, signal: AbortSignal): Promise<void> {
    const source = await this.storage.getObject(sourceKey);
    await pipeline(source, createWriteStream(targetPath), { signal });
  }

  private async hasObject(key: string): Promise<boolean> {
    try {
      await this.storage.getObjectSizeBytes(key);
      return true;
    } catch (error) {
      if (error instanceof ObjectNotFoundError) return false;
      throw error;
    }
  }

  private buildLevelPlaylistKey(hlsPrefix: string, rung: QualityRung): string {
    return `${hlsPrefix}/${rung.level}p/index.m3u8`;
  }

  private async createPosters(
    sourcePath: string,
    workDir: string,
    hlsPrefix: string,
    video: VideoMetadata,
    signal: AbortSignal,
  ): Promise<void> {
    for (const width of POSTER_WIDTHS) {
      const fileName = `poster_${width}.jpg`;
      const outputPath = join(workDir, fileName);
      await this.transcoder.createPoster({ sourcePath, outputPath, width, video, signal });
      await this.storage.putObject({
        key: `${hlsPrefix}/${fileName}`,
        body: await readFile(outputPath),
        contentType: 'image/jpeg',
        cacheControl: IMMUTABLE_CACHE_CONTROL,
      });
    }
  }

  private async encodeAndUploadLevel(
    sourcePath: string,
    workDir: string,
    hlsPrefix: string,
    rung: QualityRung,
    video: VideoMetadata,
    signal: AbortSignal,
  ): Promise<void> {
    const outputDir = join(workDir, `${rung.level}p`);
    await mkdir(outputDir, { recursive: true });
    await this.transcoder.encodeLevel({ sourcePath, outputDir, rung, video, signal });

    const levelPlaylist = await readFile(join(outputDir, 'index.m3u8'));
    assertTailLongEnough(levelPlaylist.toString());

    const segmentNames = (await readdir(outputDir)).filter((name) => name.endsWith('.ts')).sort();
    for (let start = 0; start < segmentNames.length; start += UPLOAD_CONCURRENCY) {
      signal.throwIfAborted();
      await Promise.all(
        segmentNames.slice(start, start + UPLOAD_CONCURRENCY).map(async (name) =>
          this.storage.putObject({
            key: `${hlsPrefix}/${rung.level}p/${name}`,
            body: await readFile(join(outputDir, name)),
            contentType: 'video/mp2t',
            cacheControl: IMMUTABLE_CACHE_CONTROL,
          }),
        ),
      );
    }
    await this.storage.putObject({
      key: this.buildLevelPlaylistKey(hlsPrefix, rung),
      body: levelPlaylist,
      contentType: PLAYLIST_CONTENT_TYPE,
      cacheControl: IMMUTABLE_CACHE_CONTROL,
    });
    await rm(outputDir, { recursive: true, force: true });
  }

  private async uploadMaster(hlsPrefix: string, rungs: QualityRung[], video: VideoMetadata): Promise<void> {
    await this.storage.putObject({
      key: `${hlsPrefix}/master.m3u8`,
      body: Buffer.from(buildMasterPlaylist(rungs, video)),
      contentType: PLAYLIST_CONTENT_TYPE,
      cacheControl: MASTER_CACHE_CONTROL,
    });
  }
}
