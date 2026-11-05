import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { ContentMediaTranscodeRequestedV1 } from '@tripflix/contracts';
import { Transactional } from '@tripflix/db';
import {
  ObjectNotFoundError,
  UploadExpiredError,
  UploadIncompleteError,
  type ObjectStorage,
  type UploadedPart,
} from '@tripflix/storage';
import { MediaError } from '../domain/errors.js';
import {
  PART_SIZE_BYTES,
  UPLOAD_LINK_TTL_SECONDS,
  assertAllPartsListed,
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

export interface CompletedUpload {
  assetId: string;
  status: 'processing' | 'ready';
}

/** Cấp, ký lại link tải lên và hoàn tất upload. App PUT thẳng từng phần lên S3, backend không nhận file. */
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

  /** Gọi lại nhiều lần vẫn cho cùng kết quả và chỉ giao việc chuyển mã một lần. */
  async completeUpload(ownerId: string, assetId: string, parts: UploadedPart[]): Promise<CompletedUpload> {
    const target = await this.store.findUploadTarget(assetId, ownerId);
    if (!target) throw new MediaError('MEDIA_NOT_FOUND', 'Không tìm thấy video');
    if (target.status === 'processing' || target.status === 'ready') return { assetId, status: target.status };
    if (target.status !== 'uploading' || !target.s3UploadId) {
      throw new MediaError('MEDIA_UPLOAD_NOT_ACTIVE', 'Video này không còn ở trạng thái đang tải lên');
    }
    assertAllPartsListed(target.fileSizeBytes, parts.map((part) => part.partNumber));

    // S3 nằm ngoài transaction. Ghi database lỗi thì app gọi lại, assembleSourceFile nhận ra file đã ghép.
    await this.assembleSourceFile(target.sourceKey, target.s3UploadId, parts);
    await this.assertSourceFileSize(target.sourceKey, target.fileSizeBytes);
    await this.requestTranscode(assetId, ownerId, target.sourceKey);
    return { assetId, status: 'processing' };
  }

  private async assembleSourceFile(key: string, uploadId: string, parts: UploadedPart[]): Promise<void> {
    try {
      await this.storage.completeMultipartUpload({ key, uploadId, parts });
    } catch (error) {
      if (error instanceof UploadIncompleteError) {
        throw new MediaError('MEDIA_UPLOAD_INCOMPLETE', 'Thiếu phần hoặc ETag không khớp');
      }
      // Phiên mất có thể do lần gọi trước đã ghép xong; assertSourceFileSize sẽ phân biệt bằng file gốc.
      if (!(error instanceof UploadExpiredError)) throw error;
    }
  }

  private async assertSourceFileSize(key: string, expectedSizeBytes: number): Promise<void> {
    let actualSizeBytes: number;
    try {
      actualSizeBytes = await this.storage.getObjectSizeBytes(key);
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        throw new MediaError('MEDIA_UPLOAD_EXPIRED', 'Phiên tải lên đã hết hạn, cần tải lại video');
      }
      throw error;
    }
    if (actualSizeBytes !== expectedSizeBytes) {
      throw new MediaError('MEDIA_UPLOAD_INCOMPLETE', 'Dung lượng file không khớp với lúc xin link');
    }
  }

  @Transactional('content')
  private async requestTranscode(assetId: string, ownerId: string, sourceKey: string): Promise<void> {
    const revision = await this.store.markProcessing(assetId);
    if (revision === null) return;
    const payload: ContentMediaTranscodeRequestedV1 = { assetId, sourceKey, revision };
    await this.store.outbox.add({ type: 'content.media.transcode_requested', userId: ownerId, payload });
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
