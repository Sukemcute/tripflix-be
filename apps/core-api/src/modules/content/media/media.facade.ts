import { Inject, Injectable } from '@nestjs/common';
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
  ) {}

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
      id: asset.id, kind: asset.kind, status: asset.status,
      revision: createHash('sha256').update(JSON.stringify([
        asset.kind, asset.status, asset.sourceKey, asset.hlsPrefix, asset.updatedAt.toISOString(),
      ])).digest('hex'),
      url: asset.status === 'ready'
        ? this.storage.getCdnUrl(asset.kind === 'image' ? asset.sourceKey : `${asset.hlsPrefix}/poster_540.jpg`)
        : null,
    }));
  }
}
