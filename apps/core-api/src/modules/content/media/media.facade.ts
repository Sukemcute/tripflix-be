import { Inject, Injectable, Optional } from '@nestjs/common';
import { MediaFramesUseCases } from './application/media-frames.use-cases.js';
import { createHash } from 'node:crypto';
import type { MediaAspect, MediaQualityLevel } from '@tripflix/contracts';
import type { ObjectStorage } from '@tripflix/storage';
import {
  MEDIA_ASSET_STORE,
  OBJECT_STORAGE,
  type MediaAssetStatus,
  type MediaAssetStore,
  type MediaKindInfo,
} from './application/ports.js';

export interface PlaybackInfo {
  /** master.m3u8 trên CloudFront. */
  hlsUrl: string;
  /** App chọn cỡ nhỏ nhất không nhỏ hơn chiều rộng màn hình. */
  posters: { w360: string; w540: string; w720: string };
  durationSec: number;
  aspect: MediaAspect;
  levels: MediaQualityLevel[];
}

export interface ImageInfo {
  /** Link CDN của ảnh gốc. */
  url: string;
  widthPx: number | null;
  heightPx: number | null;
}

/** Hàm cho phần khác của hệ thống lấy thông tin phát video. Giao diện ở docs/09, mục Hàm cho module khác. */
@Injectable()
export class MediaFacade {
  constructor(
    @Inject(MEDIA_ASSET_STORE) private readonly store: MediaAssetStore,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Optional() @Inject(MediaFramesUseCases) private readonly frames?: MediaFramesUseCases,
  ) {}

  async ensureModerationFrames(assetIds: string[], actorId?: string) {
    await this.frames?.ensure(assetIds, actorId);
  }
  async getModerationFrames(assetIds: string[]) {
    const scans = (await this.frames?.list(assetIds)) ?? [];
    return scans.map((scan) => ({
      assetId: scan.assetId,
      requestId: scan.requestId,
      status: scan.status,
      policy: scan.policy,
      errorCode: scan.errorCode,
      durationMs: scan.manifest?.durationMs ?? null,
      frames:
        scan.manifest?.frames.map((frame) => ({
          timestampMs: frame.timestampMs,
          url: this.storage.getCdnUrl(frame.key),
        })) ?? [],
    }));
  }

  /** Read poster from private storage for OCR, with a hard byte cap. Never fetch arbitrary URLs. */
  async readModerationVideoPoster(assetId: string): Promise<Buffer> {
    const [asset] = await this.store.findModerationAssets([assetId]);
    if (!asset || asset.kind !== 'video' || asset.status !== 'ready' || !asset.hlsPrefix)
      throw new Error('Video poster is not ready');
    const key = `${asset.hlsPrefix}/poster_540.jpg`;
    if ((await this.storage.getObjectSizeBytes(key)) > 2_000_000)
      throw new Error('Video poster exceeds OCR size limit');
    const stream = await this.storage.getObject(key);
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of stream) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      size += bytes.length;
      if (size > 2_000_000) {
        stream.destroy();
        throw new Error('Video poster exceeds OCR size limit');
      }
      chunks.push(bytes);
    }
    const poster = Buffer.concat(chunks);
    if (!poster.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])))
      throw new Error('Video poster is not JPEG');
    return poster;
  }

  /** Chỉ có video phát được: id không tồn tại hoặc chưa ready thì không có trong kết quả. */
  async getPlayback(assetIds: string[]): Promise<Record<string, PlaybackInfo>> {
    const assets = await this.store.findPlaybackAssets([...new Set(assetIds)]);
    return Object.fromEntries(
      assets.map(({ id, hlsPrefix, durationSec, aspect, levels }) => [
        id,
        {
          hlsUrl: this.storage.getCdnUrl(`${hlsPrefix}/master.m3u8`),
          posters: {
            w360: this.storage.getCdnUrl(`${hlsPrefix}/poster_360.jpg`),
            w540: this.storage.getCdnUrl(`${hlsPrefix}/poster_540.jpg`),
            w720: this.storage.getCdnUrl(`${hlsPrefix}/poster_720.jpg`),
          },
          durationSec,
          aspect,
          levels,
        },
      ]),
    );
  }

  /** Trả null khi video không tồn tại. */
  getStatus(assetId: string): Promise<MediaAssetStatus | null> {
    return this.store.findStatus(assetId);
  }

  /** Chỉ ảnh đã tải lên xong: id không tồn tại, chưa xong hay là video thì không có trong kết quả. */
  async getImages(assetIds: string[]): Promise<Record<string, ImageInfo>> {
    const images = await this.store.findReadyImages([...new Set(assetIds)]);
    return Object.fromEntries(
      images.map(({ id, sourceKey, widthPx, heightPx }) => [
        id,
        { url: this.storage.getCdnUrl(sourceKey), widthPx, heightPx },
      ]),
    );
  }

  /** Loại (video hay ảnh), chủ và trạng thái của từng id có tồn tại. */
  getKinds(assetIds: string[]): Promise<MediaKindInfo[]> {
    return this.store.findKinds([...new Set(assetIds)]);
  }

  /** Metadata + pure CDN URL construction; safe inside the caller's transaction. */
  async getModerationInputs(assetIds: string[], lock = false) {
    const assets = await this.store.findModerationAssets([...new Set(assetIds)], lock);
    return assets.map((asset) => ({
      id: asset.id,
      kind: asset.kind,
      status: asset.status,
      revision: createHash('sha256')
        .update(
          JSON.stringify([
            asset.kind,
            asset.status,
            asset.sourceKey,
            asset.hlsPrefix,
            asset.updatedAt.toISOString(),
          ]),
        )
        .digest('hex'),
      url:
        asset.status === 'ready'
          ? this.storage.getCdnUrl(
              asset.kind === 'image' ? asset.sourceKey : `${asset.hlsPrefix}/poster_540.jpg`,
            )
          : null,
    }));
  }
}
