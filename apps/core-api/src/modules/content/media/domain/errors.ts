export type MediaErrorCode =
  | 'MEDIA_TOO_LARGE'
  | 'MEDIA_NOT_FOUND'
  | 'MEDIA_UPLOAD_NOT_ACTIVE'
  | 'MEDIA_INVALID_PART_NUMBER'
  | 'MEDIA_UPLOAD_INCOMPLETE'
  | 'MEDIA_UPLOAD_EXPIRED';

/** Lỗi nghiệp vụ của media; tầng api đổi sang mã HTTP. */
export class MediaError extends Error {
  constructor(
    readonly code: MediaErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'MediaError';
  }
}
