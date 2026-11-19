import type { MediaAspect, MediaQualityLevel } from '@tripflix/contracts';
import type { PostMediaInfo } from '../../domain/index.js';

export interface PostVideoPlayback {
  hlsUrl: string;
  posters: { w360: string; w540: string; w720: string };
  durationSec: number;
  aspect: MediaAspect;
  levels: MediaQualityLevel[];
}

/**
 * Port tra loại media và link ảnh từ module media (qua MediaFacade).
 * Social không đọc bảng media_assets.
 */
export interface PostMediaPort {
  /** Map id -> loại, chủ, trạng thái; id không tồn tại thì không có trong Map. */
  findMediaInfo(mediaIds: string[]): Promise<Map<string, PostMediaInfo>>;
  /** Map id -> ảnh đã tải xong; id không phải ảnh ready thì không có trong Map. */
  getImages(mediaIds: string[]): Promise<Map<string, PostImage>>;
  /** Map id -> thông tin phát video (HLS, poster); id không phải video ready thì không có trong Map. */
  getPlayback?(mediaIds: string[]): Promise<Map<string, PostVideoPlayback>>;
}

export interface PostImage {
  id: string;
  url: string;
  widthPx: number | null;
  heightPx: number | null;
}

export const POST_MEDIA_PORT = Symbol('POST_MEDIA_PORT');
