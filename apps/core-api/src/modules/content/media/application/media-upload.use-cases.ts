import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { ObjectStorage } from '@tripflix/storage';
import { MediaError } from '../domain/errors.js';
import {
  PART_SIZE_BYTES,
  UPLOAD_LINK_TTL_SECONDS,
  assertWithinUploadLimits,
  buildAllPartNumbers,
  buildSourceRelativeKey,
  resolveRequestedPartNumbers,
  roundUpDurationSeconds,
  type MediaMimeType,
} from '../domain/upload-rules.js';
import {
  MEDIA_ASSET_STORE,
  MEDIA_CLOCK,
  OBJECT_STORAGE,
  type MediaAssetStore,
  type MediaClock,
} from './ports.js';

export interface CreateUploadInput {
  mimeType: MediaMimeType;
  fileSizeBytes: number;
  durationSec: number;
}

export interface SignedPart {
  partNumber: number;
  url: string;
}

export interface SignedParts {
  parts: SignedPart[];
  expiresAt: string;
}

export interface CreatedUpload extends SignedParts {
  assetId: string;
  partSizeBytes: number;
}

/** Cấp và ký lại link tải lên. App PUT thẳng từng phần lên S3, backend không nhận file. */
@Injectable()
export class MediaUploadUseCases {
  constructor(
    @Inject(MEDIA_ASSET_STORE) private readonly store: MediaAssetStore,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(MEDIA_CLOCK) private readonly now: MediaClock,
  ) {}

  async createUpload(ownerId: string, input: CreateUploadInput): Promise<CreatedUpload> {
    const durationSec = roundUpDurationSeconds(input.durationSec);
    assertWithinUploadLimits(input.fileSizeBytes, durationSec);

    const assetId = randomUUID();
    const sourceKey = this.storage.resolveKey(buildSourceRelativeKey(assetId, input.mimeType));
    // Gọi S3 trước, không nằm trong transaction. Ghi database lỗi thì lifecycle của S3 tự xoá phiên dở sau 1 ngày.
    const s3UploadId = await this.storage.createMultipartUpload({ key: sourceKey, contentType: input.mimeType });
    await this.store.insertUploadingAsset({
      id: assetId,
      ownerId,
      mimeType: input.mimeType,
      fileSizeBytes: input.fileSizeBytes,
      sourceKey,
      s3UploadId,
      durationSec,
    });

    const signedParts = await this.signParts(sourceKey, s3UploadId, buildAllPartNumbers(input.fileSizeBytes));
    return { assetId, partSizeBytes: PART_SIZE_BYTES, ...signedParts };
  }

  async resignParts(ownerId: string, assetId: string, partNumbers: number[]): Promise<SignedParts> {
    const target = await this.store.findUploadTarget(assetId, ownerId);
    if (!target) throw new MediaError('MEDIA_NOT_FOUND', 'Không tìm thấy video');
    if (target.status !== 'uploading' || !target.s3UploadId) {
      throw new MediaError('MEDIA_UPLOAD_NOT_ACTIVE', 'Video này không còn ở trạng thái đang tải lên');
    }
    const requestedPartNumbers = resolveRequestedPartNumbers(target.fileSizeBytes, partNumbers);
    return this.signParts(target.sourceKey, target.s3UploadId, requestedPartNumbers);
  }

  private async signParts(key: string, uploadId: string, partNumbers: number[]): Promise<SignedParts> {
    // Lấy giờ trước khi ký để expiresAt không bao giờ muộn hơn hạn thật của link.
    const expiresAt = new Date(this.now().getTime() + UPLOAD_LINK_TTL_SECONDS * 1000).toISOString();
    const parts = await Promise.all(
      partNumbers.map(async (partNumber) => ({
        partNumber,
        url: await this.storage.signUploadPart({
          key,
          uploadId,
          partNumber,
          expiresInSeconds: UPLOAD_LINK_TTL_SECONDS,
        }),
      })),
    );
    return { parts, expiresAt };
  }
}
