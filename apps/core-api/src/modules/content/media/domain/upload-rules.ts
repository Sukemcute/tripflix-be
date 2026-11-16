import { MediaError } from './errors.js';

export const VIDEO_MIME_TYPES = ['video/mp4', 'video/quicktime'] as const;
/** Ảnh của bài viết (vlog). Không chuyển mã: tải lên xong, kiểm đúng định dạng là dùng được. */
export const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const MEDIA_MIME_TYPES = [...VIDEO_MIME_TYPES, ...IMAGE_MIME_TYPES] as const;
export type VideoMimeType = (typeof VIDEO_MIME_TYPES)[number];
export type ImageMimeType = (typeof IMAGE_MIME_TYPES)[number];
export type MediaMimeType = VideoMimeType | ImageMimeType;
export type MediaKind = 'video' | 'image';

export function isImageMimeType(mimeType: MediaMimeType): mimeType is ImageMimeType {
  return (IMAGE_MIME_TYPES as readonly string[]).includes(mimeType);
}

export function getMediaKind(mimeType: MediaMimeType): MediaKind {
  return isImageMimeType(mimeType) ? 'image' : 'video';
}

/** Bằng đúng một phần upload, nên ảnh luôn chỉ có một link PUT. */
export const MAX_IMAGE_FILE_SIZE_BYTES = 10 * 1024 * 1024;
/** Cạnh dài nhất app được khai, chặn số vô lý; ảnh điện thoại 200MP cũng dưới mức này. */
export const MAX_IMAGE_DIMENSION_PX = 20_000;

export const MAX_DURATION_SECONDS = 5 * 60;
export const MAX_FILE_SIZE_BYTES = 1024 * 1024 * 1024;
export const PART_SIZE_BYTES = 10 * 1024 * 1024;
export const MAX_PART_COUNT = Math.ceil(MAX_FILE_SIZE_BYTES / PART_SIZE_BYTES);
export const UPLOAD_LINK_TTL_SECONDS = 60 * 60;

const SOURCE_FILE_EXTENSIONS: Record<MediaMimeType, string> = {
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export function assertWithinUploadLimits(fileSizeBytes: number, durationSec: number): void {
  if (durationSec > MAX_DURATION_SECONDS) {
    throw new MediaError('MEDIA_TOO_LARGE', 'Video dài quá 5 phút');
  }
  if (fileSizeBytes > MAX_FILE_SIZE_BYTES) {
    throw new MediaError('MEDIA_TOO_LARGE', 'Video lớn quá 1 GB');
  }
}

export function assertImageWithinUploadLimits(fileSizeBytes: number): void {
  if (fileSizeBytes > MAX_IMAGE_FILE_SIZE_BYTES) {
    throw new MediaError('MEDIA_TOO_LARGE', 'Ảnh lớn quá 10 MB');
  }
}

/** Số byte đầu file cần đọc để nhận ra định dạng ảnh (WebP cần 12 byte). */
export const IMAGE_SIGNATURE_BYTES = 12;

/**
 * Nhận định dạng ảnh từ các byte đầu file thay vì tin loại app khai, để không ai tải file khác lên
 * dưới tên ảnh. Không nhận ra thì trả null.
 */
export function detectImageMimeType(head: Uint8Array): ImageMimeType | null {
  const startsWith = (bytes: number[], offset = 0) => bytes.every((byte, index) => head[offset + index] === byte);
  if (startsWith([0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  // "RIFF" <4 byte độ dài> "WEBP"
  if (startsWith([0x52, 0x49, 0x46, 0x46]) && startsWith([0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
  return null;
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
  // Ảnh được đọc thẳng qua CDN nên để chung nhánh images/ với ảnh khách sạn, tách khỏi file video gốc.
  if (isImageMimeType(mimeType)) return `images/posts/${assetId}.${SOURCE_FILE_EXTENSIONS[mimeType]}`;
  return `uploads/${assetId}/original.${SOURCE_FILE_EXTENSIONS[mimeType]}`;
}
