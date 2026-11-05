import { MediaError } from './errors.js';

export const MEDIA_MIME_TYPES = ['video/mp4', 'video/quicktime'] as const;
export type MediaMimeType = (typeof MEDIA_MIME_TYPES)[number];

export const MAX_DURATION_SECONDS = 5 * 60;
export const MAX_FILE_SIZE_BYTES = 1024 * 1024 * 1024;
export const PART_SIZE_BYTES = 10 * 1024 * 1024;
export const MAX_PART_COUNT = Math.ceil(MAX_FILE_SIZE_BYTES / PART_SIZE_BYTES);
export const UPLOAD_LINK_TTL_SECONDS = 60 * 60;

const SOURCE_FILE_EXTENSIONS: Record<MediaMimeType, string> = {
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
};

export function assertWithinUploadLimits(fileSizeBytes: number, durationSec: number): void {
  if (durationSec > MAX_DURATION_SECONDS) {
    throw new MediaError('MEDIA_TOO_LARGE', 'Video dài quá 5 phút');
  }
  if (fileSizeBytes > MAX_FILE_SIZE_BYTES) {
    throw new MediaError('MEDIA_TOO_LARGE', 'Video lớn quá 1 GB');
  }
}

export function calculatePartCount(fileSizeBytes: number): number {
  return Math.ceil(fileSizeBytes / PART_SIZE_BYTES);
}

export function buildAllPartNumbers(fileSizeBytes: number): number[] {
  return Array.from({ length: calculatePartCount(fileSizeBytes) }, (_, index) => index + 1);
}

/** Trả về các số phần không trùng; số ngoài phạm vi của file thì báo lỗi. */
export function resolveRequestedPartNumbers(fileSizeBytes: number, partNumbers: number[]): number[] {
  const partCount = calculatePartCount(fileSizeBytes);
  const uniquePartNumbers = [...new Set(partNumbers)];
  if (uniquePartNumbers.some((partNumber) => partNumber > partCount)) {
    throw new MediaError('MEDIA_INVALID_PART_NUMBER', `Video này chỉ có ${partCount} phần`);
  }
  return uniquePartNumbers;
}

/**
 * Kiểm trước khi gọi S3: S3 không biết file có bao nhiêu phần, sẽ ghép thiếu rồi xoá phiên upload,
 * khiến app không tải tiếp được phần còn thiếu.
 */
export function assertAllPartsListed(fileSizeBytes: number, partNumbers: number[]): void {
  const partCount = calculatePartCount(fileSizeBytes);
  const uniquePartNumbers = new Set(partNumbers);
  const isExactlyAllParts =
    partNumbers.length === partCount &&
    uniquePartNumbers.size === partCount &&
    partNumbers.every((partNumber) => partNumber >= 1 && partNumber <= partCount);
  if (!isExactlyAllParts) {
    throw new MediaError('MEDIA_UPLOAD_INCOMPLETE', `Cần gửi đủ ${partCount} phần, mỗi phần một lần`);
  }
}

/** Cột là số nguyên; làm tròn lên để video 300,5 giây vẫn bị tính là quá giới hạn. */
export function roundUpDurationSeconds(durationSec: number): number {
  return Math.ceil(durationSec);
}

export function buildSourceRelativeKey(assetId: string, mimeType: MediaMimeType): string {
  return `uploads/${assetId}/original.${SOURCE_FILE_EXTENSIONS[mimeType]}`;
}
