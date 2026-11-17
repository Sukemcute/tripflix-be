import { assertMediaKindsForPostType, PostMediaNotAllowedException, type PostMediaInfo } from '../../domain/index.js';
import type { PostType, TripAttachmentData } from '../../../db/schema/index.js';
import type { PostMediaPort } from '../ports/post-media.port.js';

/**
 * Hỏi module media loại của từng id rồi kiểm luật gắn media vào bài. Không có port (test cũ) thì coi như
 * không tìm thấy id nào: bài viết kèm id lạ vẫn bị chặn.
 */
export async function assertPostMediaAllowed(
  postMedia: PostMediaPort | undefined,
  options: { postType: PostType; authorId: string; mediaIds: readonly string[] },
): Promise<void> {
  if (options.mediaIds.length === 0) return;
  const mediaInfo = postMedia
    ? await postMedia.findMediaInfo([...options.mediaIds])
    : new Map<string, PostMediaInfo>();
  assertMediaKindsForPostType(options.postType, options.authorId, options.mediaIds, mediaInfo);
}

const TRIP_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Lộ trình lưu nguyên JSON nên làm sạch trước khi ghi (TF105): bỏ posterUrl (chỉ sinh lúc đọc, không cho client gửi
 * link tuỳ ý), bỏ giờ sai dạng HH:mm, làm gọn khách sạn của từng điểm, và poster phải là ảnh đã tải xong của chính tác giả.
 */
export async function prepareTripAttachment<T extends TripAttachmentData | null | undefined>(
  postMedia: PostMediaPort | undefined,
  authorId: string,
  attachment: T,
): Promise<T> {
  if (!attachment) return attachment;
  const { posterUrl: _posterUrl, ...rest } = attachment;
  const items = rest.items?.map(({ time, hotel, ...item }) => ({
    ...item,
    ...(time && TRIP_TIME_PATTERN.test(time) ? { time } : {}),
    // Khách sạn của từng điểm (TF105): chỉ giữ khi có mã khách sạn, bỏ trường lạ client gửi kèm.
    ...(hotel && typeof hotel.hotelId === 'string' && hotel.hotelId
      ? {
          hotel: {
            hotelId: hotel.hotelId,
            ...(typeof hotel.productId === 'string' && hotel.productId ? { productId: hotel.productId } : {}),
            ...(typeof hotel.ratePlanCode === 'string' && hotel.ratePlanCode ? { ratePlanCode: hotel.ratePlanCode } : {}),
          },
        }
      : {}),
  }));
  if (rest.posterMediaId) {
    const info = postMedia ? (await postMedia.findMediaInfo([rest.posterMediaId])).get(rest.posterMediaId) : undefined;
    if (!info || info.kind !== 'image' || info.ownerId !== authorId || info.status !== 'ready') {
      throw new PostMediaNotAllowedException('Ảnh poster lộ trình chưa tải lên xong hoặc không phải ảnh của bạn');
    }
  }
  return { ...rest, ...(items ? { items } : {}) } as T;
}
